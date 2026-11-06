using System.Globalization;
using System.Net.Http.Headers;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32;

// Optional, read-only update hints. Never touches the vault, binaries or release workflow.
static class UpdateCheck
{
    private const string RegistryPath = @"Software\IPSys\UpdateReminder";
    private const string ReleasesApi = "https://api.github.com/repos/zy19970/IPSys/releases?per_page=30";
    private const string ReleasePage = "https://github.com/zy19970/IPSys/releases/tag/";
    private static readonly TimeSpan Interval = TimeSpan.FromHours(24);
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static readonly HttpClient Client = MakeClient();
    private static readonly Regex VersionPattern = new(
        @"^v?(?<major>0|[1-9][0-9]*)\.(?<minor>0|[1-9][0-9]*)\.(?<patch>0|[1-9][0-9]*)(?:-(?<pre>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex LegacyRc = new(
        @"^(rc|alpha|beta|preview)([0-9]+)$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

    private static bool _loaded;
    private static DateTimeOffset _checkedUtc;
    private static string _latestTag = "";
    private static DateTimeOffset _notifiedUtc;
    private static string _notifiedTag = "";

    private static HttpClient MakeClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(4) };
        client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("IPSys", "1.0"));
        client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return client;
    }

    public static void Map(WebApplication app)
    {
        app.MapGet("/api/update/check", async (HttpContext ctx, Vault vault) =>
        {
            if (!vault.Allowed(ctx)) return Results.Unauthorized();
            string current = InstalledVersion();
            if (!TryParseVersion(current, out var installed) ||
                (installed.Major == 0 && installed.Minor == 0 && installed.Patch == 0))
            {
                return Results.Json(new { ok = true, supported = false, currentVersion = current,
                    updateAvailable = false, notify = false,
                    message = "当前为开发构建，未设置正式发布版本号。" });
            }

            bool force = ctx.Request.Query["force"] == "1";
            await Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                LoadCache();
                var now = DateTimeOffset.UtcNow;
                if (force || _checkedUtc == default || now - _checkedUtc >= Interval)
                {
                    try
                    {
                        _latestTag = await QueryLatestReleaseAsync(ctx.RequestAborted);
                        _checkedUtc = now;
                        SaveCache();
                    }
                    catch (OperationCanceledException) when (ctx.RequestAborted.IsCancellationRequested)
                    {
                        throw;
                    }
                    catch (Exception)
                    {
                        return Results.Json(new { ok = false, supported = true,
                            currentVersion = current, updateAvailable = false, notify = false,
                            message = "无法连接 GitHub 检查更新，请检查网络后重试。" });
                    }
                }

                bool available = TryParseVersion(_latestTag, out var latest) &&
                    Compare(latest, installed) > 0;
                bool notify = available && (_notifiedTag != _latestTag ||
                    _notifiedUtc == default || now - _notifiedUtc >= Interval);
                // Automatic checks show at most one nonmodal reminder per tag/day,
                // including after app restarts. Manual checks never consume this quota.
                if (!force && notify)
                {
                    _notifiedTag = _latestTag;
                    _notifiedUtc = now;
                    SaveCache();
                }

                return Results.Json(new { ok = true, supported = true,
                    currentVersion = current, latestVersion = _latestTag,
                    updateAvailable = available, notify = !force && notify,
                    releaseUrl = available ? ReleasePage + Uri.EscapeDataString(_latestTag) : "",
                    message = _latestTag.Length == 0 ? "未找到可用的 Windows 发布版本。"
                        : available ? "发现新版本。" : "当前已经是最新版本。" });
            }
            finally { Gate.Release(); }
        });
    }

    internal static string InstalledVersion() =>
        typeof(UpdateCheck).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion?.Trim() ?? "0.0.0-dev";

    private static async Task<string> QueryLatestReleaseAsync(CancellationToken stop)
    {
        using var response = await Client.GetAsync(ReleasesApi, stop);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(stop);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: stop);
        return SelectLatestRelease(document.RootElement);
    }

    // Pure helper: smoke tests use a synthetic release list without network access.
    internal static string SelectLatestRelease(JsonElement releases)
    {
        if (releases.ValueKind != JsonValueKind.Array)
            throw new InvalidDataException("GitHub Releases response was not a list.");

        string bestTag = "";
        VersionKey best = default;
        foreach (var release in releases.EnumerateArray())
        {
            if (release.ValueKind != JsonValueKind.Object ||
                !release.TryGetProperty("draft", out var draft) ||
                draft.ValueKind != JsonValueKind.False ||
                !release.TryGetProperty("tag_name", out var tagValue) ||
                tagValue.ValueKind != JsonValueKind.String ||
                !release.TryGetProperty("assets", out var assets) ||
                assets.ValueKind != JsonValueKind.Array) continue;
            string tag = tagValue.GetString() ?? "";
            if (!tag.StartsWith("v", StringComparison.Ordinal) ||
                !TryParseVersion(tag, out var version)) continue;
            bool hasFramework = false, hasSelfContained = false;
            foreach (var asset in assets.EnumerateArray())
            {
                if (asset.ValueKind != JsonValueKind.Object ||
                    !asset.TryGetProperty("name", out var name) ||
                    name.ValueKind != JsonValueKind.String) continue;
                string file = name.GetString() ?? "";
                hasFramework |= file == "IPSys-win-x64-FrameworkDependent.exe";
                hasSelfContained |= file == "IPSys-win-x64-SelfContained.exe";
            }
            if (!hasFramework || !hasSelfContained) continue;
            if (bestTag.Length == 0 || Compare(version, best) > 0)
            {
                bestTag = tag;
                best = version;
            }
        }
        return bestTag;
    }

    internal readonly record struct VersionKey(int Major, int Minor, int Patch, string[] Pre);
    internal static bool TryParseVersion(string? value, out VersionKey result)
    {
        result = default;
        if (string.IsNullOrWhiteSpace(value)) return false;
        var match = VersionPattern.Match(value);
        if (!match.Success ||
            !int.TryParse(match.Groups["major"].Value, out int major) ||
            !int.TryParse(match.Groups["minor"].Value, out int minor) ||
            !int.TryParse(match.Groups["patch"].Value, out int patch)) return false;
        string pre = match.Groups["pre"].Value;
        if (pre.Length > 0) pre = LegacyRc.Replace(pre, "$1.$2");
        result = new VersionKey(major, minor, patch,
            pre.Length == 0 ? Array.Empty<string>() : pre.Split('.'));
        return true;
    }

    internal static int Compare(VersionKey a, VersionKey b)
    {
        int c = a.Major.CompareTo(b.Major);
        if (c != 0) return c;
        c = a.Minor.CompareTo(b.Minor);
        if (c != 0) return c;
        c = a.Patch.CompareTo(b.Patch);
        if (c != 0) return c;
        if (a.Pre.Length == 0) return b.Pre.Length == 0 ? 0 : 1;
        if (b.Pre.Length == 0) return -1;
        int count = Math.Min(a.Pre.Length, b.Pre.Length);
        for (int i = 0; i < count; i++)
        {
            var x = a.Pre[i];
            var y = b.Pre[i];
            bool xn = x.All(char.IsAsciiDigit), yn = y.All(char.IsAsciiDigit);
            if (xn && yn)
            {
                string xx = x.TrimStart('0'), yy = y.TrimStart('0');
                c = xx.Length.CompareTo(yy.Length);
                if (c == 0) c = string.CompareOrdinal(xx, yy);
            }
            else if (xn != yn) c = xn ? -1 : 1;
            else c = string.CompareOrdinal(x, y);
            if (c != 0) return c;
        }
        return a.Pre.Length.CompareTo(b.Pre.Length);
    }

    private static void LoadCache()
    {
        if (_loaded) return;
        _loaded = true;
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RegistryPath);
            if (key == null) return;
            _latestTag = key.GetValue("LatestTag") as string ?? "";
            if (!TryParseVersion(_latestTag, out _)) _latestTag = "";
            _notifiedTag = key.GetValue("NotifiedTag") as string ?? "";
            _checkedUtc = ReadDate(key.GetValue("CheckedUtc") as string);
            _notifiedUtc = ReadDate(key.GetValue("NotifiedUtc") as string);
        }
        catch { /* Update hints must never interrupt the vault. */ }
    }

    private static DateTimeOffset ReadDate(string? value)
    {
        if (!long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out long seconds))
            return default;
        try { return DateTimeOffset.FromUnixTimeSeconds(seconds); }
        catch (ArgumentOutOfRangeException) { return default; }
    }

    private static void SaveCache()
    {
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(RegistryPath);
            if (key == null) return;
            key.SetValue("LatestTag", _latestTag);
            key.SetValue("CheckedUtc", _checkedUtc.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture));
            key.SetValue("NotifiedTag", _notifiedTag);
            if (_notifiedUtc != default)
                key.SetValue("NotifiedUtc", _notifiedUtc.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture));
        }
        catch { /* Best-effort current-user update cache only. */ }
    }
}
