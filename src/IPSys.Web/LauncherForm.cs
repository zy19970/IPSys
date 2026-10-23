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
    private readonly Label _memoryValue;
    private readonly Label _cpuValue;
    private readonly Label _uptimeValue;
    private readonly System.Windows.Forms.Timer _monitorTimer;
    private readonly Process _process;
    private readonly Stopwatch _uptime = Stopwatch.StartNew();
    private TimeSpan _previousCpuTime;
    private long _previousSampleTick;
    private bool _explicitExit;
    private readonly ContextMenuStrip _trayMenu;
    private readonly NotifyIcon _trayIcon;

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
        ClientSize = new Size(500, 246);
        MinimumSize = Size;
        MaximumSize = Size;
        BackColor = Canvas;
        Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Regular);

        // Brand block, aligned to the top-left rather than a giant heading.
        var logo = new PictureBox
        {
            Location = new Point(20, 17),
            Size = new Size(30, 30),
            SizeMode = PictureBoxSizeMode.Zoom,
            Image = Icon?.ToBitmap()
        };
        var heading = MakeLabel("资料管理系统", new Rectangle(60, 13, 275, 38),
            16F, FontStyle.Bold, TextPrimary);

        var statusCard = new LauncherCard { Location = new Point(352, 17), Size = new Size(132, 33) };
        statusCard.Controls.Add(MakeLabel("●", new Rectangle(4, 4, 16, 24),
            9F, FontStyle.Bold, Color.FromArgb(16, 124, 16)));
        _status = MakeLabel("服务运行中", new Rectangle(22, 3, 107, 26),
            9F, FontStyle.Regular, TextSecondary);
        statusCard.Controls.Add(_status);

        var monitorCard = new LauncherCard { Location = new Point(18, 65), Size = new Size(464, 106) };
        monitorCard.Controls.Add(MakeLabel("内存占用", new Rectangle(19, 14, 131, 23),
            9F, FontStyle.Regular, TextSecondary));
        monitorCard.Controls.Add(MakeLabel("CPU 占用", new Rectangle(173, 14, 129, 23),
            9F, FontStyle.Regular, TextSecondary));
        monitorCard.Controls.Add(MakeLabel("运行时长", new Rectangle(329, 14, 125, 23),
            9F, FontStyle.Regular, TextSecondary));
        _memoryValue = MakeLabel("—", new Rectangle(19, 46, 137, 34),
            15F, FontStyle.Bold, TextPrimary);
        _cpuValue = MakeLabel("—", new Rectangle(173, 46, 139, 34),
            15F, FontStyle.Bold, TextPrimary);
        _uptimeValue = MakeLabel("00:00:00", new Rectangle(329, 46, 130, 34),
            14F, FontStyle.Bold, TextPrimary);
        monitorCard.Controls.AddRange(new Control[] { _memoryValue, _cpuValue, _uptimeValue });
        monitorCard.Controls.Add(new Panel { Location = new Point(155, 16), Size = new Size(1, 72), BackColor = Stroke });
        monitorCard.Controls.Add(new Panel { Location = new Point(311, 16), Size = new Size(1, 72), BackColor = Stroke });

        var launch = MakeButton("打开管理界面", new Rectangle(18, 186, 296, 43), primary: true);
        launch.Click += (_, _) => OpenBrowser();
        var exit = MakeButton("退出程序", new Rectangle(328, 186, 154, 43), primary: false);
        exit.Click += (_, _) => RequestExit();
        Controls.AddRange(new Control[] { logo, heading, statusCard, monitorCard, launch, exit });
        AcceptButton = launch;

        _trayMenu = new ContextMenuStrip();
        _trayMenu.Items.Add("打开主窗口", null, (_, _) => RestoreFromTray());
        _trayMenu.Items.Add(new ToolStripSeparator());
        _trayMenu.Items.Add("退出程序", null, (_, _) => RequestExit());
        _trayIcon = new NotifyIcon
        {
            Icon = Icon ?? SystemIcons.Application,
            Text = "资料管理系统",
            ContextMenuStrip = _trayMenu
        };
        _trayIcon.DoubleClick += (_, _) => RestoreFromTray();

        // Both ASP.NET and this launcher live inside IPSys.Web.exe. Sampling
        // that process therefore includes the UI and the local HTTP host.
        _process = Process.GetCurrentProcess();
        _previousCpuTime = _process.TotalProcessorTime;
        _previousSampleTick = Stopwatch.GetTimestamp();
        _monitorTimer = new System.Windows.Forms.Timer { Interval = 1000 };
        _monitorTimer.Tick += (_, _) => UpdateResourceMonitor();
        Shown += (_, _) =>
        {
            _trayIcon.Visible = true;
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
        _trayIcon.Visible = false;
        _trayIcon.Dispose();
        _trayMenu.Dispose();
        _monitorTimer.Stop();
        _monitorTimer.Dispose();
        _process.Dispose();
        base.OnFormClosed(e);
    }

    private void RequestExit()
    {
        if(_vault.ExitRequested || _stopping.IsCancellationRequested)return;
        // In-flight file tasks may need the existing three-choice dialog.
        if(_vault.FileTaskActive && !Visible)RestoreFromTray();
        _explicitExit = true;
        Close();
    }

    internal void HideToTray()
    {
        if(IsDisposed)return;
        _trayIcon.Visible = true;
        Hide();
        ShowInTaskbar = false;
    }

    internal void RestoreFromTray()
    {
        if(IsDisposed)return;
        ShowInTaskbar = true;
        if(WindowState == FormWindowState.Minimized)
            WindowState = FormWindowState.Normal;
        if(!Visible)Show();
        Activate();
    }

    // X hides to tray; only explicit Exit invokes file-task safety checks.
    internal static bool ShouldHideToTray(CloseReason reason,bool explicitExit,bool stopping)=>
        reason==CloseReason.UserClosing && !explicitExit && !stopping;

    // Returning a selected database path always hides the launcher so the
    // browser login is unobstructed. Cancel preserves the previous visibility.
    internal static bool HideAfterFilePicker(bool selected,bool wasHidden)=>
        selected || wasHidden;

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if(ShouldHideToTray(e.CloseReason,_explicitExit,_stopping.IsCancellationRequested))
        {
            e.Cancel = true;
            HideToTray();
            base.OnFormClosing(e);
            return;
        }
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
            // Clear the one-shot intent even when the user cancels the
            // file-task dialog or an exit preflight rejects the request.
            _explicitExit = false;
            string? choice = _vault.FileTaskActive ? ShowFileTaskExitChoices() : "normal";
            if (choice != null)
            {
                if (_vault.TryScheduleExit(choice, _lifetime, out string error))
                    _status.Text = "正在退出…";
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
        }
        catch (Exception ex)
        {
            MessageBox.Show(this,
                "无法自动打开浏览器，请在 Edge 或 Chrome 手动访问：\n\n" +
                _address.TrimEnd('/') + "\n\n错误：" + ex.Message,
                "打开浏览器失败", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

}

internal static class LauncherHost
{
    private static LauncherForm? _activeForm;

    // Invoke the actual Windows file chooser on the launcher's STA thread.
    // Browsers intentionally cannot supply an absolute path via file inputs.
    internal static async Task<string?> ChooseDatabasePathAsync(
        bool create,string? currentPath,CancellationToken cancellation)
    {
        var form=Volatile.Read(ref _activeForm);
        if(form is null || form.IsDisposed || !form.IsHandleCreated)
            throw new InvalidOperationException("启动器窗口尚未就绪，请在程序启动后重试。");

        var answer=new TaskCompletionSource<string?>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        try
        {
            form.BeginInvoke((MethodInvoker)(() =>
            {
                try
                {
                    if(form.IsDisposed)
                        throw new InvalidOperationException("启动器窗口已关闭。");

                    string directory=AppContext.BaseDirectory;
                    string name="IPSys.db";
                    if(!string.IsNullOrWhiteSpace(currentPath))
                    {
                        try
                        {
                            var full=Path.GetFullPath(currentPath);
                            var parent=Path.GetDirectoryName(full);
                            if(parent is not null && Directory.Exists(parent))
                            {
                                directory=parent;
                                name=Path.GetFileName(full);
                            }
                        }
                        catch(ArgumentException) {}
                        catch(NotSupportedException) {}
                        catch(IOException) {}
                    }

                    bool wasHidden=!form.Visible ||
                        form.WindowState==FormWindowState.Minimized;
                    if(wasHidden)form.RestoreFromTray();
                    else form.Activate();
                    string? selectedPath=null;
                    try
                    {
                        using FileDialog picker=create
                            ? new SaveFileDialog
                            {
                                Title="选择新资料库的保存位置",
                                AddExtension=true,
                                DefaultExt="db",
                                OverwritePrompt=false,
                                CheckPathExists=true
                            }
                            : new OpenFileDialog
                            {
                                Title="选择已有资料库",
                                CheckFileExists=true,
                                CheckPathExists=true
                            };
                        picker.Filter="资料库 (*.db;*.sqlite;*.sqlite3)|*.db;*.sqlite;*.sqlite3|所有文件 (*.*)|*.*";
                        picker.InitialDirectory=directory;
                        picker.FileName=name;
                        if(picker is SaveFileDialog save)
                            save.FileOk += (_,eventArgs) =>
                            {
                                if(!File.Exists(save.FileName))return;
                                eventArgs.Cancel=true;
                                MessageBox.Show(form,"已有同名文件，请选择其他文件名。不会覆盖现有资料库。",
                                    "文件已存在",MessageBoxButtons.OK,MessageBoxIcon.Warning);
                            };
                        if(picker.ShowDialog(form)==DialogResult.OK)
                            selectedPath=Path.GetFullPath(picker.FileName);
                    }
                    finally
                    {
                        if(!form.IsDisposed &&
                           LauncherForm.HideAfterFilePicker(selectedPath is not null,wasHidden))
                            form.HideToTray();
                    }
                    answer.TrySetResult(selectedPath);
                }
                catch(Exception ex){answer.TrySetException(ex);}
            }));
        }
        catch(InvalidOperationException)
        {
            throw new InvalidOperationException("启动器窗口已退出，无法选择资料库。");
        }
        return await answer.Task.WaitAsync(cancellation);
    }

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
                Volatile.Write(ref _activeForm,form);
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
                try { Application.Run(form); }
                finally { Volatile.Write(ref _activeForm,null); }
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
