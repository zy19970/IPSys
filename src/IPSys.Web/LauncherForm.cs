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

    internal LauncherForm(string address, Vault vault, IHostApplicationLifetime lifetime, CancellationToken stopping)
    {
        _address = address;
        _vault = vault;
        _lifetime = lifetime;
        _stopping = stopping;
        Text = "IPSys · 本地管理系统";
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        MinimizeBox = true;
        ShowInTaskbar = true;
        ClientSize = new Size(470, 272);
        MinimumSize = Size;
        MaximumSize = Size;
        AutoScaleMode = AutoScaleMode.Dpi;
        BackColor = Color.FromArgb(247, 249, 251);
        Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Regular);

        var heading = new Label
        {
            Text = "IPSys",
            Font = new Font(Font.FontFamily, 22F, FontStyle.Bold),
            ForeColor = Color.FromArgb(29, 88, 99),
            Location = new Point(28, 25),
            AutoSize = true
        };
        var summary = new Label
        {
            Text = "本地知识产权与资料管理 · 试运行",
            Location = new Point(32, 83),
            ForeColor = Color.FromArgb(105, 119, 131),
            AutoSize = true
        };
        _status = new Label
        {
            Text = "● 本地服务已启动   ·   仅本机访问",
            Location = new Point(32, 116),
            ForeColor = Color.FromArgb(52, 130, 97),
            AutoSize = true
        };
        var launch = new Button
        {
            Text = "打开浏览器管理界面",
            Location = new Point(30, 160),
            Size = new Size(255, 48),
            FlatStyle = FlatStyle.Flat,
            ForeColor = Color.White,
            BackColor = Color.FromArgb(35, 109, 121),
            Cursor = Cursors.Hand
        };
        launch.FlatAppearance.BorderSize = 0;
        launch.Click += (_, _) => OpenBrowser();

        var exit = new Button
        {
            Text = "退出程序",
            Location = new Point(304, 160),
            Size = new Size(136, 48),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.White,
            ForeColor = Color.FromArgb(65, 81, 95),
            Cursor = Cursors.Hand
        };
        exit.FlatAppearance.BorderColor = Color.FromArgb(214, 223, 231);
        exit.Click += (_, _) => Close();

        var hint = new Label
        {
            Text = "关闭此窗口将安全停止本地服务；浏览器标签可以单独关闭。",
            Location = new Point(31, 232),
            ForeColor = Color.FromArgb(131, 144, 157),
            Font = new Font(Font.FontFamily, 8.5F),
            AutoSize = true
        };
        Controls.AddRange(new Control[] { heading, summary, _status, launch, exit, hint });
        AcceptButton = launch;
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
                    _status.Text = "● 正在安全退出并关闭数据库…";
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
            ClientSize = new Size(465, 165),
            Font = Font
        };
        dialog.Controls.Add(new Label
        {
            Text = "正在上传文件。请选择退出处理方式：",
            Location = new Point(20, 22),
            Size = new Size(420, 45)
        });
        var cancelTask = new Button
        {
            Text = "取消任务并退出", DialogResult = DialogResult.Yes,
            Location = new Point(16, 90), Size = new Size(142, 42)
        };
        var wait = new Button
        {
            Text = "任务完成后退出", DialogResult = DialogResult.No,
            Location = new Point(163, 90), Size = new Size(142, 42)
        };
        var stay = new Button
        {
            Text = "暂不退出", DialogResult = DialogResult.Cancel,
            Location = new Point(310, 90), Size = new Size(142, 42)
        };
        dialog.Controls.AddRange(new Control[] { cancelTask, wait, stay });
        dialog.CancelButton = stay;
        return dialog.ShowDialog(this) switch
        {
            DialogResult.Yes => "cancel",
            DialogResult.No => "wait",
            _ => null
        };
    }

    private void OpenBrowser(string relativePath = "")
    {
        try
        {
            string target = _address.TrimEnd('/') + relativePath;
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
            _status.Text = relativePath.Length == 0
                ? "● 管理界面已在浏览器中打开"
                : "● 模拟界面设计预览已在浏览器中打开";
        }
        catch (Exception ex)
        {
            _status.Text = "● 本地服务仍在运行";
            MessageBox.Show(this,
                "无法自动打开浏览器，请在 Edge 或 Chrome 手动访问：\n\n" +
                (_address.TrimEnd('/') + relativePath) + "\n\n错误：" + ex.Message,
                "打开浏览器失败", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }
}

internal static class LauncherHost
{
    /// <summary>
    /// Run WinForms on its own STA thread. The ASP.NET host uses the async main thread.
    /// ApplicationStopping (including the web page's Safe Exit button) closes the form.
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
