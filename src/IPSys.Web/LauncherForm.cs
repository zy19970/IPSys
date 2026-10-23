using System.Diagnostics;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Extensions.Hosting;

namespace IPSys.Web;

/// <summary>
/// Small Windows launcher: runs the local web application only while the form exists.
/// The browser is a client. Closing its tab does not stop the local service.
/// </summary>
internal sealed class LauncherForm : Form
{
    private readonly string _address;
    private readonly Label _status;
    private readonly Vault _vault;
    private readonly IHostApplicationLifetime _lifetime;
    private readonly CancellationToken _stopping;
    private readonly Label _browserStatus;
    private readonly Label _memoryValue;
    private readonly Label _cpuValue;
    private readonly Label _uptimeValue;
    private readonly System.Windows.Forms.Timer _monitorTimer;
    private readonly Process _process;
    private readonly Stopwatch _uptime = Stopwatch.StartNew();
    private TimeSpan _previousCpuTime;
    private long _previousSampleTick;

    // Same restrained blue/neutral palette as the Explorer/OneDrive-style web shell.
    private static readonly Color Canvas = Color.FromArgb(247, 249, 252);
    private static readonly Color Accent = Color.FromArgb(15, 108, 189);
    private static readonly Color TextPrimary = Color.FromArgb(36, 36, 36);
    private static readonly Color TextSecondary = Color.FromArgb(97, 97, 97);
    private static readonly Color Stroke = Color.FromArgb(225, 229, 235);

    internal LauncherForm(string address, Vault vault, IHostApplicationLifetime lifetime, CancellationToken stopping)
    {
        _address = address;
        _vault = vault;
        _lifetime = lifetime;
        _stopping = stopping;
        Text = "资料管理系统";
        using (var iconStream = typeof(LauncherForm).Assembly.GetManifestResourceStream("IPSys.Web.AppIcon.ico"))
        {
            if (iconStream is not null) Icon = new Icon(iconStream);
        }

        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        MinimizeBox = true;
        ShowInTaskbar = true;
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(580, 460);
        MinimumSize = Size;
        MaximumSize = Size;
        BackColor = Canvas;
        Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Regular);

        // Brand block, aligned to the top-left rather than a giant heading.
        var logo = new PictureBox
        {
            Location = new Point(28, 27),
            Size = new Size(36, 36),
            SizeMode = PictureBoxSizeMode.Zoom,
            Image = Icon?.ToBitmap()
        };
        var heading = MakeLabel("资料管理系统", new Rectangle(77, 22, 450, 39),
            20F, FontStyle.Bold, TextPrimary);
        var summary = MakeLabel("本地加密资料管理", new Rectangle(79, 65, 430, 24),
            10F, FontStyle.Regular, TextSecondary);

        var statusCard = new LauncherCard { Location = new Point(24, 108), Size = new Size(532, 92) };
        statusCard.Controls.Add(MakeLabel("运行状态", new Rectangle(22, 12, 180, 25),
            10.5F, FontStyle.Bold, TextPrimary));
        statusCard.Controls.Add(MakeLabel("●", new Rectangle(22, 48, 16, 25),
            10F, FontStyle.Bold, Color.FromArgb(16, 124, 16)));
        _status = MakeLabel("本地服务运行中", new Rectangle(42, 47, 220, 28),
            10F, FontStyle.Regular, TextPrimary);
        _browserStatus = MakeLabel("管理界面尚未打开", new Rectangle(277, 48, 232, 26),
            9F, FontStyle.Regular, TextSecondary);
        _browserStatus.TextAlign = ContentAlignment.MiddleRight;
        statusCard.Controls.AddRange(new Control[] { _status, _browserStatus });

        var monitorCard = new LauncherCard { Location = new Point(24, 213), Size = new Size(532, 132) };
        monitorCard.Controls.Add(MakeLabel("资源监控", new Rectangle(22, 12, 180, 25),
            10.5F, FontStyle.Bold, TextPrimary));
        monitorCard.Controls.Add(MakeLabel("内存占用", new Rectangle(22, 49, 135, 23),
            9F, FontStyle.Regular, TextSecondary));
        monitorCard.Controls.Add(MakeLabel("CPU 占用", new Rectangle(194, 49, 135, 23),
            9F, FontStyle.Regular, TextSecondary));
        monitorCard.Controls.Add(MakeLabel("运行时长", new Rectangle(367, 49, 130, 23),
            9F, FontStyle.Regular, TextSecondary));
        _memoryValue = MakeLabel("—", new Rectangle(22, 74, 143, 34),
            15F, FontStyle.Bold, TextPrimary);
        _cpuValue = MakeLabel("—", new Rectangle(194, 74, 140, 34),
            15F, FontStyle.Bold, TextPrimary);
        _uptimeValue = MakeLabel("00:00:00", new Rectangle(367, 74, 150, 34),
            15F, FontStyle.Bold, TextPrimary);
        monitorCard.Controls.AddRange(new Control[] { _memoryValue, _cpuValue, _uptimeValue });
        monitorCard.Controls.Add(new Panel { Location = new Point(180, 52), Size = new Size(1, 55), BackColor = Stroke });
        monitorCard.Controls.Add(new Panel { Location = new Point(354, 52), Size = new Size(1, 55), BackColor = Stroke });

        var launch = MakeButton("打开管理界面", new Rectangle(24, 363, 341, 46), primary: true);
        launch.Click += (_, _) => OpenBrowser();
        var exit = MakeButton("退出程序", new Rectangle(378, 363, 178, 46), primary: false);
        exit.Click += (_, _) => Close();
        var hint = MakeLabel("关闭此窗口将停止本地服务。", new Rectangle(26, 425, 510, 22),
            8.5F, FontStyle.Regular, TextSecondary);
        Controls.AddRange(new Control[] { logo, heading, summary, statusCard, monitorCard, launch, exit, hint });
        AcceptButton = launch;

        // Both ASP.NET and this launcher live inside IPSys.Web.exe. Sampling
        // that process therefore includes the UI and the local HTTP host.
        _process = Process.GetCurrentProcess();
        _previousCpuTime = _process.TotalProcessorTime;
        _previousSampleTick = Stopwatch.GetTimestamp();
        _monitorTimer = new System.Windows.Forms.Timer { Interval = 1000 };
        _monitorTimer.Tick += (_, _) => UpdateResourceMonitor();
        Shown += (_, _) =>
        {
            UpdateResourceMonitor();
            _monitorTimer.Start();
        };
    }

    private Label MakeLabel(string text, Rectangle bounds, float size, FontStyle style, Color color) =>
        new()
        {
            Text = text,
            Location = bounds.Location,
            Size = bounds.Size,
            Font = new Font(Font.FontFamily, size, style),
            ForeColor = color,
            BackColor = Color.Transparent,
            TextAlign = ContentAlignment.MiddleLeft,
            AutoEllipsis = true
        };

    private static Button MakeButton(string text, Rectangle bounds, bool primary)
    {
        var button = new Button
        {
            Text = text,
            Location = bounds.Location,
            Size = bounds.Size,
            Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Bold),
            BackColor = primary ? Accent : Color.White,
            ForeColor = primary ? Color.White : TextPrimary,
            FlatStyle = FlatStyle.Flat,
            UseVisualStyleBackColor = false,
            Cursor = Cursors.Hand
        };
        button.FlatAppearance.BorderSize = primary ? 0 : 1;
        button.FlatAppearance.BorderColor = Stroke;
        button.FlatAppearance.MouseOverBackColor = primary
            ? Color.FromArgb(17, 90, 163) : Color.FromArgb(241, 246, 251);
        button.FlatAppearance.MouseDownBackColor = primary
            ? Color.FromArgb(12, 59, 94) : Color.FromArgb(232, 236, 242);
        button.Resize += (_, _) => RoundButton(button);
        RoundButton(button);
        return button;
    }

    private static void RoundButton(Button button)
    {
        if (button.Width <= 0 || button.Height <= 0) return;
        using var outline = RoundedRect(new Rectangle(0, 0, button.Width, button.Height), 7);
        var old = button.Region;
        button.Region = new Region(outline);
        old?.Dispose();
    }

    private static System.Drawing.Drawing2D.GraphicsPath RoundedRect(Rectangle r, int radius)
    {
        var path = new System.Drawing.Drawing2D.GraphicsPath();
        int d = radius * 2;
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    private sealed class LauncherCard : Panel
    {
        internal LauncherCard()
        {
            BackColor = Color.White;
            DoubleBuffered = true;
        }

        protected override void OnSizeChanged(EventArgs e)
        {
            base.OnSizeChanged(e);
            if (Width < 2 || Height < 2) return;
            using var outline = RoundedRect(new Rectangle(0, 0, Width, Height), 9);
            var old = Region;
            Region = new Region(outline);
            old?.Dispose();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            if (Width < 2 || Height < 2) return;
            e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using var path = RoundedRect(new Rectangle(0, 0, Width - 1, Height - 1), 9);
            using var fill = new SolidBrush(Color.White);
            using var border = new Pen(Stroke);
            e.Graphics.FillPath(fill, path);
            e.Graphics.DrawPath(border, path);
        }
    }

    private void UpdateResourceMonitor()
    {
        TimeSpan elapsed = _uptime.Elapsed;
        _uptimeValue.Text = $"{(long)elapsed.TotalHours:00}:{elapsed.Minutes:00}:{elapsed.Seconds:00}";
        try
        {
            _process.Refresh();
            _memoryValue.Text = $"{_process.WorkingSet64 / (1024d * 1024d):0} MB";

            long now = Stopwatch.GetTimestamp();
            TimeSpan currentCpu = _process.TotalProcessorTime;
            double wallMs = Stopwatch.GetElapsedTime(_previousSampleTick, now).TotalMilliseconds;
            double cpuMs = (currentCpu - _previousCpuTime).TotalMilliseconds;
            if (wallMs > 0)
                _cpuValue.Text = $"{Math.Clamp(cpuMs / wallMs / Environment.ProcessorCount * 100d, 0d, 100d):0.0}%";
            _previousCpuTime = currentCpu;
            _previousSampleTick = now;
        }
        catch (InvalidOperationException)
        {
            _memoryValue.Text = "—";
            _cpuValue.Text = "—";
        }
        catch (System.ComponentModel.Win32Exception)
        {
            _memoryValue.Text = "—";
            _cpuValue.Text = "—";
        }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _monitorTimer.Stop();
        _monitorTimer.Dispose();
        _process.Dispose();
        base.OnFormClosed(e);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        // A second click on X must not bypass a previously scheduled safe exit.
        if (_vault.ExitRequested && !_stopping.IsCancellationRequested)
        {
            e.Cancel = true;
            base.OnFormClosing(e);
            return;
        }
        if (e.CloseReason == CloseReason.UserClosing &&
            !_stopping.IsCancellationRequested)
        {
            e.Cancel = true;
            string? choice = _vault.FileTaskActive ? ShowFileTaskExitChoices() : "normal";
            if (choice != null)
            {
                if (_vault.TryScheduleExit(choice, _lifetime, out string error))
                    _status.Text = "正在安全退出…";
                else
                    MessageBox.Show(this, error, "无法退出", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
        base.OnFormClosing(e);
    }

    private string? ShowFileTaskExitChoices()
    {
        using var dialog = new Form
        {
            Text = "文件任务进行中",
            StartPosition = FormStartPosition.CenterParent,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
            ShowInTaskbar = false,
            ClientSize = new Size(476, 169),
            AutoScaleMode = AutoScaleMode.Dpi,
            BackColor = Canvas,
            Font = Font
        };
        dialog.Controls.Add(new Label
        {
            Text = "文件任务正在执行，请选择退出方式。",
            Location = new Point(20, 23),
            Size = new Size(436, 46),
            ForeColor = TextPrimary,
            TextAlign = ContentAlignment.MiddleLeft
        });
        var cancelTask = MakeButton("取消任务并退出", new Rectangle(16, 97, 143, 42), primary: false);
        cancelTask.DialogResult = DialogResult.Yes;
        var wait = MakeButton("任务完成后退出", new Rectangle(165, 97, 144, 42), primary: true);
        wait.DialogResult = DialogResult.No;
        var stay = MakeButton("暂不退出", new Rectangle(315, 97, 143, 42), primary: false);
        stay.DialogResult = DialogResult.Cancel;
        dialog.Controls.AddRange(new Control[] { cancelTask, wait, stay });
        dialog.CancelButton = stay;
        return dialog.ShowDialog(this) switch
        {
            DialogResult.Yes => "cancel",
            DialogResult.No => "wait",
            _ => null
        };
    }

    private void OpenBrowser()
    {
        try
        {
            string target = _address.TrimEnd('/');
            // Reuse the default browser only when it is Chrome/Edge. Otherwise use Edge.
            string? browser = null;
            using (var choice = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice"))
            {
                string? id = choice?.GetValue("ProgId") as string;
                if (id?.Contains("ChromeHTML", StringComparison.OrdinalIgnoreCase) == true ||
                    id?.Contains("MSEdgeHTM", StringComparison.OrdinalIgnoreCase) == true)
                    browser = null;
                else
                    browser = "msedge.exe";
            }
            Process.Start(browser is null
                ? new ProcessStartInfo(target) { UseShellExecute = true }
                : new ProcessStartInfo(browser, target) { UseShellExecute = true });
            _browserStatus.Text = "已启动浏览器管理界面";
        }
        catch (Exception ex)
        {
            _browserStatus.Text = "管理界面尚未打开";
            MessageBox.Show(this,
                "无法自动打开浏览器，请在 Edge 或 Chrome 手动访问：\n\n" +
                _address.TrimEnd('/') + "\n\n错误：" + ex.Message,
                "打开浏览器失败", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

}

internal static class LauncherHost
{
    /// <summary>
    /// Run WinForms on its own STA thread. The ASP.NET host uses the async main thread.
    /// ApplicationStopping closes the form after WinForms schedules safe exit.
    /// </summary>
    internal static Task WaitForExitAsync(string address, CancellationToken stopping,
        Vault vault, IHostApplicationLifetime lifetime)
    {
        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            try
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                using var form = new LauncherForm(address, vault, lifetime, stopping);
                using var callback = stopping.Register(() =>
                {
                    try
                    {
                        if (form.IsHandleCreated && !form.IsDisposed)
                            form.BeginInvoke((MethodInvoker)(() => form.Close()));
                    }
                    catch (ObjectDisposedException) { }
                    catch (InvalidOperationException) { }
                });

                form.Shown += (_, _) =>
                {
                    if (stopping.IsCancellationRequested) form.BeginInvoke((MethodInvoker)(() => form.Close()));
                };
                Application.Run(form);
                completion.TrySetResult();
            }
            catch (Exception ex) { completion.TrySetException(ex); }
        })
        {
            Name = "IPSys-WinForms-Launcher",
            IsBackground = true
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        return completion.Task;
    }
}
