using System.Diagnostics;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace IPSys.Web;

/// <summary>
/// Small Windows launcher: runs the local web application only while the form exists.
/// The browser is a client. Closing its tab does not stop the local service.
/// </summary>
internal sealed class LauncherForm : Form
{
    private readonly string _address;
    private readonly Label _status;

    internal LauncherForm(string address)
    {
        _address = address;
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

    private void OpenBrowser()
    {
        try
        {
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
                ? new ProcessStartInfo(_address) { UseShellExecute = true }
                : new ProcessStartInfo(browser, _address) { UseShellExecute = true });
            _status.Text = "● 管理界面已在浏览器中打开";
        }
        catch (Exception ex)
        {
            _status.Text = "● 本地服务仍在运行";
            MessageBox.Show(this,
                "无法自动打开浏览器，请在 Edge 或 Chrome 手动访问：\n\n" +
                _address + "\n\n错误：" + ex.Message,
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
    internal static Task WaitForExitAsync(string address, CancellationToken stopping)
    {
        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            try
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                using var form = new LauncherForm(address);
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
