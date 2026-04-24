using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using Microsoft.Win32;
using Forms = System.Windows.Forms;
using MediaBrush = System.Windows.Media.Brush;
using MediaColor = System.Windows.Media.Color;
using MediaFontFamily = System.Windows.Media.FontFamily;
using WpfButton = System.Windows.Controls.Button;
using WpfCursors = System.Windows.Input.Cursors;
using WpfTextBox = System.Windows.Controls.TextBox;

namespace QuickText.Setup;

public partial class MainWindow
{
    private enum SetupState
    {
        Idle,
        Launching,
        Loading,
        Success,
        UpdateAvailable,
        Error,
        Removing,
    }

    private readonly string _defaultInstallPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Programs",
        "Quick Text");

    private bool _installComplete;
    private bool _installDialogRepairMode;
    private bool _installing;
    private bool _updateAvailable;
    private bool _sidebarModulePreviewPinned;
    private long _transferLastBytes;
    private DateTime _transferLastSampleAt = DateTime.UtcNow;
    private long _transferTotalBytes;
    private bool _showingHeroA = true;
    private bool _showingCoreA = true;
    private bool _showingSceneA = true;
    private SetupState _currentState = SetupState.Idle;
    private string? _currentHeroSource;
    private string? _currentCoreSource;
    private string? _currentSceneSource;

    private const string MissingHeroSource = "pack://application:,,,/Assets/missing-hero-alpha.png";
    private const string InstallHeroSource = "pack://application:,,,/Assets/install-hero-alpha.png";
    private const string UninstallHeroSource = "pack://application:,,,/Assets/uninstall-hero-alpha.png";
    private const string SuccessHeroSource = "pack://application:,,,/Assets/success-hero-alpha.png";
    private const string UpdateHeroSource = "pack://application:,,,/Assets/update-hero-alpha.png";
    private const string ErrorHeroSource = "pack://application:,,,/Assets/error-hero-alpha.png";
    private const string IdleCoreSource = "pack://application:,,,/Assets/idle-core.png";
    private const string ProgressCoreSource = "pack://application:,,,/Assets/progress-core.png";
    private const string SuccessCoreSource = "pack://application:,,,/Assets/success-core.png";
    private const string UpdateCoreSource = "pack://application:,,,/Assets/update-core.png";
    private const string RemoveCoreSource = "pack://application:,,,/Assets/remove-core.png";
    private const string ErrorCoreSource = "pack://application:,,,/Assets/error-core.png";
    private const string IdleSceneSource = "pack://application:,,,/Assets/idle-scene.png";
    private const string ProgressSceneSource = "pack://application:,,,/Assets/progress-scene.png";
    private const string SuccessSceneSource = "pack://application:,,,/Assets/success-scene.png";
    private const string UpdateSceneSource = "pack://application:,,,/Assets/update-scene.png";
    private const string RemoveSceneSource = "pack://application:,,,/Assets/remove-scene.png";
    private const string ErrorSceneSource = "pack://application:,,,/Assets/error-scene.png";
    private const int MaxActivityEntries = 20;
    private const int StateCrossfadeDurationMs = 480;
    private const double ShellCornerRadius = 18;

    private readonly Dictionary<string, BitmapImage> _imageCache = new(StringComparer.OrdinalIgnoreCase);

    public MainWindow()
    {
        InitializeComponent();
        InstallPathBox.Text = _defaultInstallPath;
        SyncInstallPathPreview();
        Loaded += (_, _) => ApplyRoundedShellClip();
        SizeChanged += (_, _) => ApplyRoundedShellClip();
        WarmImageCache();

        RefreshInstallState();
        AddActivity("Kira LC setup shell ready.", "info");
        TransitionToState(
            GetInstalledReadyState(),
            _installComplete ? "Quick Text is already installed." : "Quick Text is not installed.");
    }

    private void DragWindow(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left && !IsInteractiveSource(e.OriginalSource as DependencyObject))
        {
            DragMove();
        }
    }

    private static bool IsInteractiveSource(DependencyObject? source)
    {
        while (source is not null)
        {
            if (source is WpfButton or WpfTextBox or System.Windows.Controls.Primitives.ScrollBar)
            {
                return true;
            }

            if (source is FrameworkElement { Cursor: var cursor } && ReferenceEquals(cursor, WpfCursors.Hand))
            {
                return true;
            }

            try
            {
                source = VisualTreeHelper.GetParent(source);
            }
            catch (InvalidOperationException)
            {
                return false;
            }
        }

        return false;
    }

    private void ApplyRoundedShellClip()
    {
        if (ShellContent.ActualWidth <= 0 || ShellContent.ActualHeight <= 0)
        {
            return;
        }

        ShellContent.Clip = new RectangleGeometry(
            new Rect(0, 0, ShellContent.ActualWidth, ShellContent.ActualHeight),
            ShellCornerRadius,
            ShellCornerRadius);
    }

    private void MinimizeWindow(object sender, RoutedEventArgs e)
    {
        WindowState = WindowState.Minimized;
    }

    private void CloseWindow(object sender, RoutedEventArgs e)
    {
        if (_installing)
        {
            return;
        }

        Close();
    }

    private void OpenInstallDialog(object sender, RoutedEventArgs e)
    {
        ShowInstallDialog(repairMode: false);
    }

    private void OpenInstallDialogFromPanel(object sender, MouseButtonEventArgs e)
    {
        e.Handled = true;
        ShowInstallDialog(repairMode: false);
    }

    private void ToggleActionMenu(object sender, RoutedEventArgs e)
    {
        if (_installing)
        {
            return;
        }

        RefreshInstallState();
        UpdateActionAvailability();
        ActionMenuPopup.IsOpen = !ActionMenuPopup.IsOpen;
    }

    private void BrowseInstallPath(object sender, RoutedEventArgs e)
    {
        ChooseInstallPath("Choose where Kira LC installs the Quick Text module.");
    }

    private void BrowsePathFromDialog(object sender, RoutedEventArgs e)
    {
        if (ChooseInstallPath("Choose where Kira LC installs the Quick Text module."))
        {
            InstallDialogPathBox.Text = InstallPathBox.Text;
        }
    }

    private void LocateExistingInstall(object sender, RoutedEventArgs e)
    {
        if (!ChooseInstallPath("Select the folder that already contains QuickText.exe.", expectExisting: true))
        {
            return;
        }

        InstallDialogPathBox.Text = InstallPathBox.Text;
        if (_installComplete)
        {
            InstallPathDialog.Visibility = Visibility.Collapsed;
            return;
        }

        StatusText.Text = "QuickText.exe was not found in that folder.";
        ProgressText.Text = "Choose a folder that contains QuickText.exe or continue with this install path.";
    }

    private bool ChooseInstallPath(string description, bool expectExisting = false)
    {
        if (_installing)
        {
            return false;
        }

        using var dialog = new Forms.FolderBrowserDialog
        {
            Description = description,
            SelectedPath = Directory.Exists(InstallPathBox.Text) ? InstallPathBox.Text : _defaultInstallPath,
            UseDescriptionForTitle = true,
        };

        if (dialog.ShowDialog() != Forms.DialogResult.OK)
        {
            return false;
        }

        InstallPathBox.Text = dialog.SelectedPath;
        SyncInstallPathPreview();
        RefreshInstallState();
        AddActivity($"Install path set: {dialog.SelectedPath}", "info");
        TransitionToState(
            GetInstalledReadyState(),
            _installComplete
                ? "Quick Text found in the selected folder."
                : expectExisting
                    ? "QuickText.exe was not found there."
                    : "Install path updated.");

        return true;
    }

    private void SyncInstallPathPreview()
    {
        InstallPathPreviewText.Text = InstallPathBox.Text;
        InstallDialogPathBox.Text = InstallPathBox.Text;
    }

    private void RefreshInstallState()
    {
        _installComplete = IsQuickTextInstalled();
        _updateAvailable = _installComplete && IsUpdateAvailable();
        UpdateAutoUpdateIndicator();
    }

    private SetupState GetInstalledReadyState()
    {
        if (!_installComplete)
        {
            return SetupState.Idle;
        }

        return _updateAvailable ? SetupState.UpdateAvailable : SetupState.Success;
    }

    private void UpdateAutoUpdateIndicator()
    {
        var color = _updateAvailable
            ? MediaColor.FromRgb(255, 190, 42)
            : _installComplete
                ? MediaColor.FromRgb(56, 242, 122)
                : MediaColor.FromRgb(92, 200, 255);

        AutoUpdateDot.Fill = new SolidColorBrush(color);
        AutoUpdateStateText.Text = _updateAvailable
            ? "✓ Auto update: update ready"
            : _installComplete
                ? "✓ Auto update"
                : "Auto update after install";
        AutoUpdateStateText.Foreground = new SolidColorBrush(
            _updateAvailable ? MediaColor.FromRgb(255, 214, 112) : MediaColor.FromRgb(148, 156, 166));
    }

    private void InstallOrLaunch(object sender, RoutedEventArgs e)
    {
        if (_installing)
        {
            return;
        }

        RefreshInstallState();
        if (_installComplete)
        {
            if (_updateAvailable)
            {
                ShowInstallDialog(repairMode: true);
            }
            else
            {
                AddActivity("Launch requested from primary button.", "info");
                TransitionToState(SetupState.Launching, "Opening Quick Text...");
                LaunchQuickText("primary launch");
            }

            return;
        }

        ShowInstallDialog(repairMode: false);
    }

    private void ShowInstallDialog(bool repairMode)
    {
        if (_installing)
        {
            return;
        }

        ActionMenuPopup.IsOpen = false;
        RefreshInstallState();
        _installDialogRepairMode = repairMode || _installComplete;
        SyncInstallPathPreview();

        InstallDialogTitle.Text = _updateAvailable ? "Update Quick Text" : _installDialogRepairMode ? "Repair Quick Text" : "Install Quick Text";
        InstallDialogBody.Text = _updateAvailable
            ? "A newer Quick Text package is available. Update will refresh this folder and keep the same install path."
            : _installDialogRepairMode
            ? "Quick Text is already installed at the path below. Repair will refresh the files in this folder."
            : "Quick Text will be installed to the default path below. You can choose a custom folder before downloading.";
        InstallDialogPrimaryLabel.Text = _updateAvailable ? "UPDATE" : _installDialogRepairMode ? "REPAIR" : "TẢI VỀ";
        InstallPathDialog.Visibility = Visibility.Visible;
    }

    private void CloseInstallDialog(object sender, RoutedEventArgs e)
    {
        InstallPathDialog.Visibility = Visibility.Collapsed;
    }

    private async void ConfirmInstallFromDialog(object sender, RoutedEventArgs e)
    {
        if (_installing)
        {
            return;
        }

        var path = string.IsNullOrWhiteSpace(InstallDialogPathBox.Text)
            ? _defaultInstallPath
            : InstallDialogPathBox.Text.Trim();

        InstallPathBox.Text = path;
        SyncInstallPathPreview();
        InstallPathDialog.Visibility = Visibility.Collapsed;
        AddActivity(_installDialogRepairMode ? "Repair confirmed." : "Download confirmed.", "info");

        await InstallQuickTextAsync().ConfigureAwait(true);
    }

    private void LaunchFromMenu(object sender, RoutedEventArgs e)
    {
        ActionMenuPopup.IsOpen = false;
        if (!EnsureQuickTextInstalled("Launch action"))
        {
            return;
        }

        AddActivity("Launch selected from setup menu.", "success");
        TransitionToState(SetupState.Launching, "Opening Quick Text...");
        LaunchQuickText("setup menu");
    }

    private void RepairFromMenu(object sender, RoutedEventArgs e)
    {
        ShowInstallDialog(repairMode: true);
    }

    private async void UninstallFromMenu(object sender, RoutedEventArgs e)
    {
        ActionMenuPopup.IsOpen = false;
        await RemoveQuickTextAsync().ConfigureAwait(true);
    }

    private void PreviewActionVisual(object sender, RoutedEventArgs e)
    {
        if (_installing)
        {
            return;
        }

        var action = (sender as FrameworkElement)?.Tag?.ToString() ?? string.Empty;
        RefreshInstallState();

        if (action == "Primary")
        {
            action = _installComplete ? _updateAvailable ? "Update" : "Launch" : "Install";
        }
        else if (ReferenceEquals(sender, InstallMenuButton) && _installComplete)
        {
            action = _updateAvailable ? "Update" : "Repair";
        }

        switch (action)
        {
            case "Install":
                SetVisualState(InstallHeroSource, ProgressCoreSource, ProgressSceneSource);
                break;
            case "Update":
                SetVisualState(UpdateHeroSource, UpdateCoreSource, UpdateSceneSource);
                break;
            case "Launch":
            case "Repair":
                SetVisualState(SuccessHeroSource, SuccessCoreSource, SuccessSceneSource);
                break;
            case "Uninstall":
                SetVisualState(UninstallHeroSource, RemoveCoreSource, RemoveSceneSource);
                break;
        }
    }

    private void RestoreActionVisual(object sender, RoutedEventArgs e)
    {
        if (!_installing)
        {
            RestoreCurrentStateVisual();
        }
    }

    private async Task InstallQuickTextAsync()
    {
        if (_installing)
        {
            return;
        }

        _installing = true;
        AddActivity("Install started.", "info");
        TransitionToState(SetupState.Loading, "Installing Quick Text module...");
        BeginTransferUi("Installing Quick Text", GetInstallPayloadBytes());

        try
        {
            var progress = new Progress<double>(value =>
            {
                var detail = value < 0.92 ? "Deploying files and shortcuts" : "Finalizing install";
                InstallProgress.Value = Math.Max(6, Math.Min(100, value * 100));
                ProgressText.Text = detail;
                UpdateTransferUi(value, detail);
            });

            var exitCode = await InstallerEngine
                .RunSilentInstallAsync(InstallPathBox.Text, progress, CancellationToken.None)
                .ConfigureAwait(true);

            if (exitCode != 0)
            {
                throw new InvalidOperationException($"Quick Text setup engine exited with code {exitCode}.");
            }

            _installComplete = true;
            _updateAvailable = false;
            UpdateAutoUpdateIndicator();
            InstallProgress.Value = 100;
            CompleteTransferUi("Install complete");
            AddActivity("Install complete. Quick Text is ready.", "success");
            TransitionToState(SetupState.Success, "Quick Text is ready inside Kira LC.");
        }
        catch (Exception error)
        {
            _installComplete = false;
            AddActivity($"Install failed: {error.Message}", "error");
            TransitionToState(SetupState.Error, "Install failed.");
            ProgressText.Text = error.Message;
            TransferStatusText.Text = error.Message;
            System.Windows.MessageBox.Show(
                error.Message,
                "Kira LC Setup",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
        }
        finally
        {
            _installing = false;
            EndTransferUi();
            UpdateActionAvailability();
        }
    }

    private async void InstallLifecycleClicked(object sender, MouseButtonEventArgs e)
    {
        e.Handled = true;
        if (_installing)
        {
            return;
        }

        RefreshInstallState();
        if (_installComplete)
        {
            AddActivity(_updateAvailable ? "Install card selected: update is available." : "Install card selected: Quick Text is already installed.", "success");
            TransitionToState(GetInstalledReadyState(), _updateAvailable ? "Quick Text has an update ready." : "Quick Text is already installed.");
            return;
        }

        await InstallQuickTextAsync().ConfigureAwait(true);
    }

    private async void RemoveLifecycleClicked(object sender, MouseButtonEventArgs e)
    {
        e.Handled = true;
        await RemoveQuickTextAsync().ConfigureAwait(true);
    }

    private void ReadyLifecycleClicked(object sender, MouseButtonEventArgs e)
    {
        e.Handled = true;
        if (!EnsureQuickTextInstalled("Ready card"))
        {
            return;
        }

        AddActivity("Ready card selected. Launching Quick Text.", "success");
        TransitionToState(SetupState.Launching, "Opening Quick Text...");
        LaunchQuickText("ready card");
    }

    private async void ErrorLifecycleClicked(object sender, MouseButtonEventArgs e)
    {
        e.Handled = true;
        if (_installing)
        {
            return;
        }

        if (_currentState != SetupState.Error)
        {
            AddActivity("Error state is only actionable after a failed install.", "warning");
            StatusText.Text = "No error to retry.";
            ProgressText.Text = "Use LAUNCH to install or open Quick Text.";
            return;
        }

        await InstallQuickTextAsync().ConfigureAwait(true);
    }

    private async Task RemoveQuickTextAsync()
    {
        if (_installing)
        {
            return;
        }

        RefreshInstallState();
        if (!_installComplete)
        {
            AddActivity("Remove requested but Quick Text is not installed.", "warning");
            TransitionToState(SetupState.Idle, "Nothing to remove. Quick Text is not installed.");
            return;
        }

        string installPath;
        try
        {
            installPath = ValidateQuickTextInstallPathForRemoval();
        }
        catch (Exception error)
        {
            AddActivity($"Remove blocked: {error.Message}", "warning");
            TransitionToState(SetupState.Error, "Quick Text cannot be removed from this path.");
            ProgressText.Text = error.Message;
            return;
        }

        _installing = true;
        AddActivity("Remove started inside Kira LC.", "info");
        TransitionToState(SetupState.Removing, "Removing Quick Text inside Kira LC...");
        BeginTransferUi("Uninstalling Quick Text", GetDirectorySize(installPath));

        try
        {
            var transferProgress = new Progress<(double Progress, string Detail)>(update =>
            {
                UpdateTransferUi(update.Progress, update.Detail);
                ProgressText.Text = update.Detail;
            });

            await RemoveQuickTextInProcessAsync(installPath, transferProgress).ConfigureAwait(true);
            RefreshInstallState();

            if (_installComplete)
            {
                throw new IOException("QuickText.exe is still present after uninstall.");
            }

            AddActivity("Quick Text removed.", "success");
            CompleteTransferUi("Uninstall complete");
            TransitionToState(SetupState.Idle, "Quick Text removed. Ready to install again.");
        }
        catch (Exception error)
        {
            AddActivity($"Remove failed: {error.Message}", "error");
            TransitionToState(SetupState.Error, "Remove failed.");
            ProgressText.Text = error.Message;
            TransferStatusText.Text = error.Message;
        }
        finally
        {
            _installing = false;
            EndTransferUi();
            UpdateActionAvailability();
        }
    }

    private static Task RemoveQuickTextInProcessAsync(
        string installPath,
        IProgress<(double Progress, string Detail)> progress)
    {
        return Task.Run(() =>
        {
            progress.Report((0.06, "Stopping running Quick Text"));
            StopQuickTextProcesses(installPath);

            progress.Report((0.14, "Removing shortcuts"));
            DeleteKnownShortcuts();

            progress.Report((0.22, "Cleaning install records"));
            DeleteQuickTextRegistryEntries(installPath);

            DeleteInstallDirectory(installPath, progress, 0.28, 0.98);
            progress.Report((1, "Uninstall complete"));
        });
    }

    private void BeginTransferUi(string title, long totalBytes)
    {
        _transferTotalBytes = Math.Max(1, totalBytes);
        _transferLastBytes = 0;
        _transferLastSampleAt = DateTime.UtcNow;

        TransferPanel.Visibility = Visibility.Visible;
        TransferTitleText.Text = title;
        TransferProgressBar.Value = 0;
        TransferPercentText.Text = "0%";
        TransferStatusText.Text = "Preparing";
        TransferSizeText.Text = $"0 B / {FormatBytes(_transferTotalBytes)} · 0 B/s";
        LaunchButtonLabel.Text = "0%";

        LaunchButtonSweep.Opacity = 0.72;
        var sweep = new DoubleAnimation
        {
            From = -90,
            To = 270,
            Duration = TimeSpan.FromMilliseconds(1180),
            RepeatBehavior = RepeatBehavior.Forever,
        };
        LaunchButtonSweepTransform.BeginAnimation(TranslateTransform.XProperty, sweep);
    }

    private void UpdateTransferUi(double progress, string detail)
    {
        var clampedProgress = Math.Max(0, Math.Min(1, progress));
        var percent = Math.Round(clampedProgress * 100);
        var currentBytes = (long)Math.Round(_transferTotalBytes * clampedProgress);
        var now = DateTime.UtcNow;
        var elapsed = Math.Max(0.001, (now - _transferLastSampleAt).TotalSeconds);
        var speed = Math.Max(0, (currentBytes - _transferLastBytes) / elapsed);

        TransferProgressBar.Value = percent;
        TransferPercentText.Text = $"{percent:0}%";
        TransferStatusText.Text = detail;
        TransferSizeText.Text = $"{FormatBytes(currentBytes)} / {FormatBytes(_transferTotalBytes)} · {FormatBytes(speed)}/s";
        LaunchButtonLabel.Text = $"{percent:0}%";

        _transferLastBytes = currentBytes;
        _transferLastSampleAt = now;
    }

    private void CompleteTransferUi(string detail)
    {
        UpdateTransferUi(1, detail);
    }

    private void EndTransferUi()
    {
        LaunchButtonSweepTransform.BeginAnimation(TranslateTransform.XProperty, null);
        LaunchButtonSweep.Opacity = 0;
        TransferPanel.Visibility = Visibility.Collapsed;
        _transferLastBytes = 0;
        _transferTotalBytes = 0;
    }

    private static long GetInstallPayloadBytes()
    {
        using var stream = typeof(MainWindow).Assembly.GetManifestResourceStream("QuickTextSetupEngine.exe");
        return stream?.Length ?? 0;
    }

    private static long GetDirectorySize(string directoryPath)
    {
        if (string.IsNullOrWhiteSpace(directoryPath) || !Directory.Exists(directoryPath))
        {
            return 0;
        }

        long total = 0;
        var pending = new Stack<string>();
        pending.Push(directoryPath);

        while (pending.Count > 0)
        {
            var current = pending.Pop();
            try
            {
                foreach (var file in Directory.EnumerateFiles(current))
                {
                    try
                    {
                        total += new FileInfo(file).Length;
                    }
                    catch (IOException)
                    {
                    }
                    catch (UnauthorizedAccessException)
                    {
                    }
                }

                foreach (var child in Directory.EnumerateDirectories(current))
                {
                    pending.Push(child);
                }
            }
            catch (IOException)
            {
            }
            catch (UnauthorizedAccessException)
            {
            }
        }

        return total;
    }

    private string ValidateQuickTextInstallPathForRemoval()
    {
        if (string.IsNullOrWhiteSpace(InstallPathBox.Text))
        {
            throw new InvalidOperationException("Select the Quick Text install folder before uninstalling.");
        }

        var installPath = Path.GetFullPath(InstallPathBox.Text.Trim());
        var executablePath = Path.Combine(installPath, "QuickText.exe");

        if (!Directory.Exists(installPath) || !File.Exists(executablePath))
        {
            throw new InvalidOperationException("The selected folder does not contain QuickText.exe.");
        }

        var root = Path.GetPathRoot(installPath);
        if (string.IsNullOrWhiteSpace(root) ||
            string.Equals(NormalizeDirectoryPath(installPath), NormalizeDirectoryPath(root), StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("The install folder points to a drive root and cannot be removed.");
        }

        var currentProcessPath = Environment.ProcessPath;
        if (!string.IsNullOrWhiteSpace(currentProcessPath) && IsPathInDirectory(currentProcessPath, installPath))
        {
            throw new InvalidOperationException("Move KiraLC.Setup outside the install folder before uninstalling.");
        }

        InstallPathBox.Text = installPath;
        return installPath;
    }

    private static void StopQuickTextProcesses(string installPath)
    {
        var seenProcessIds = new HashSet<int>();
        foreach (var processName in new[] { "QuickText", "Quick Text" })
        {
            foreach (var process in Process.GetProcessesByName(processName))
            {
                using (process)
                {
                    if (!seenProcessIds.Add(process.Id))
                    {
                        continue;
                    }

                    try
                    {
                        var processPath = process.MainModule?.FileName;
                        if (string.IsNullOrWhiteSpace(processPath) || !IsPathInDirectory(processPath, installPath))
                        {
                            continue;
                        }

                        process.CloseMainWindow();
                        if (!process.WaitForExit(1500))
                        {
                            process.Kill(entireProcessTree: true);
                            process.WaitForExit(3000);
                        }
                    }
                    catch (Exception)
                    {
                    }
                }
            }
        }
    }

    private static void DeleteKnownShortcuts()
    {
        var shortcutNames = new[]
        {
            "Quick Text.lnk",
            "QuickText.lnk",
            "Kira LC Quick Text.lnk",
            "Uninstall Quick Text.lnk",
            "Uninstall QuickText.lnk",
        };

        var currentPrograms = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
            "Programs");
        var commonPrograms = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu),
            "Programs");
        var shortcutFolders = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory),
            currentPrograms,
            commonPrograms,
            Path.Combine(currentPrograms, "Quick Text"),
            Path.Combine(commonPrograms, "Quick Text"),
        };

        foreach (var folder in shortcutFolders.Where(path => !string.IsNullOrWhiteSpace(path)).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            foreach (var shortcutName in shortcutNames)
            {
                TryDeleteFile(Path.Combine(folder, shortcutName));
            }
        }

        TryDeleteDirectoryIfEmpty(Path.Combine(currentPrograms, "Quick Text"));
        TryDeleteDirectoryIfEmpty(Path.Combine(commonPrograms, "Quick Text"));
    }

    private static void DeleteQuickTextRegistryEntries(string installPath)
    {
        const string uninstallRegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall";

        DeleteQuickTextRegistryEntries(RegistryHive.CurrentUser, RegistryView.Default, uninstallRegistryPath, installPath);
        DeleteQuickTextRegistryEntries(RegistryHive.LocalMachine, RegistryView.Registry64, uninstallRegistryPath, installPath);
        DeleteQuickTextRegistryEntries(RegistryHive.LocalMachine, RegistryView.Registry32, uninstallRegistryPath, installPath);
    }

    private static void DeleteQuickTextRegistryEntries(
        RegistryHive hive,
        RegistryView view,
        string uninstallRegistryPath,
        string installPath)
    {
        try
        {
            using var baseKey = RegistryKey.OpenBaseKey(hive, view);
            using var uninstallKey = baseKey.OpenSubKey(uninstallRegistryPath, writable: true);
            if (uninstallKey is null)
            {
                return;
            }

            foreach (var subKeyName in uninstallKey.GetSubKeyNames())
            {
                try
                {
                    using var appKey = uninstallKey.OpenSubKey(subKeyName);
                    if (appKey is null || !IsQuickTextRegistryEntry(appKey, installPath))
                    {
                        continue;
                    }

                    uninstallKey.DeleteSubKeyTree(subKeyName, throwOnMissingSubKey: false);
                }
                catch (Exception)
                {
                }
            }
        }
        catch (Exception)
        {
        }
    }

    private static bool IsQuickTextRegistryEntry(RegistryKey appKey, string installPath)
    {
        var displayName = appKey.GetValue("DisplayName")?.ToString();
        if (string.Equals(displayName, "Quick Text", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(displayName, "QuickText", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(displayName, "Kira LC Quick Text", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return RegistryTextReferencesInstallPath(appKey.GetValue("InstallLocation")?.ToString(), installPath) ||
            RegistryTextReferencesInstallPath(appKey.GetValue("DisplayIcon")?.ToString(), installPath) ||
            RegistryTextReferencesInstallPath(appKey.GetValue("UninstallString")?.ToString(), installPath) ||
            RegistryTextReferencesInstallPath(appKey.GetValue("QuietUninstallString")?.ToString(), installPath);
    }

    private static bool RegistryTextReferencesInstallPath(string? value, string installPath)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        var expandedValue = Environment.ExpandEnvironmentVariables(value);
        return expandedValue.Contains(installPath, StringComparison.OrdinalIgnoreCase);
    }

    private static void DeleteInstallDirectory(
        string installPath,
        IProgress<(double Progress, string Detail)> progress,
        double startProgress,
        double endProgress)
    {
        var files = EnumerateFilesForRemoval(installPath);
        var totalWork = Math.Max(1, files.Sum(file => GetFileLengthForRemoval(file) + 1));
        long completedWork = 0;

        foreach (var file in files)
        {
            var fileWork = GetFileLengthForRemoval(file) + 1;
            TryDeleteFile(file);
            completedWork += fileWork;

            var progressValue = startProgress + ((endProgress - startProgress) * completedWork / totalWork);
            progress.Report((Math.Min(endProgress, progressValue), "Removing installed files"));
        }

        progress.Report((Math.Min(0.99, endProgress), "Removing install folder"));
        foreach (var directory in EnumerateDirectoriesForRemoval(installPath).OrderByDescending(path => path.Length))
        {
            TryDeleteDirectoryIfEmpty(directory);
        }

        if (Directory.Exists(installPath))
        {
            try
            {
                Directory.Delete(installPath, recursive: true);
            }
            catch (Exception)
            {
            }
        }

        var executablePath = Path.Combine(installPath, "QuickText.exe");
        if (File.Exists(executablePath))
        {
            throw new IOException("Could not remove QuickText.exe. Close Quick Text and try again.");
        }

        if (Directory.Exists(installPath) && Directory.EnumerateFileSystemEntries(installPath).Any())
        {
            throw new IOException("Some Quick Text files could not be removed. Close running tools and try again.");
        }
    }

    private static List<string> EnumerateFilesForRemoval(string installPath)
    {
        var files = new List<string>();
        var pending = new Stack<string>();
        pending.Push(installPath);

        while (pending.Count > 0)
        {
            var current = pending.Pop();
            try
            {
                files.AddRange(Directory.EnumerateFiles(current));

                foreach (var child in Directory.EnumerateDirectories(current))
                {
                    pending.Push(child);
                }
            }
            catch (Exception)
            {
            }
        }

        return files;
    }

    private static List<string> EnumerateDirectoriesForRemoval(string installPath)
    {
        var directories = new List<string> { installPath };
        var pending = new Stack<string>();
        pending.Push(installPath);

        while (pending.Count > 0)
        {
            var current = pending.Pop();
            try
            {
                foreach (var child in Directory.EnumerateDirectories(current))
                {
                    directories.Add(child);
                    pending.Push(child);
                }
            }
            catch (Exception)
            {
            }
        }

        return directories;
    }

    private static long GetFileLengthForRemoval(string file)
    {
        try
        {
            return new FileInfo(file).Length;
        }
        catch (Exception)
        {
            return 0;
        }
    }

    private static void TryDeleteFile(string file)
    {
        try
        {
            if (!File.Exists(file))
            {
                return;
            }

            File.SetAttributes(file, FileAttributes.Normal);
            File.Delete(file);
        }
        catch (Exception)
        {
        }
    }

    private static void TryDeleteDirectoryIfEmpty(string directory)
    {
        try
        {
            if (!Directory.Exists(directory) || Directory.EnumerateFileSystemEntries(directory).Any())
            {
                return;
            }

            File.SetAttributes(directory, FileAttributes.Normal);
            Directory.Delete(directory);
        }
        catch (Exception)
        {
        }
    }

    private static bool IsPathInDirectory(string path, string directory)
    {
        var fullPath = Path.GetFullPath(path);
        var fullDirectory = NormalizeDirectoryPath(directory) + Path.DirectorySeparatorChar;
        return fullPath.StartsWith(fullDirectory, StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizeDirectoryPath(string path)
    {
        return Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    }

    private static string FormatBytes(double bytes)
    {
        string[] units = ["B", "KB", "MB", "GB"];
        var value = Math.Max(0, bytes);
        var unit = 0;

        while (value >= 1024 && unit < units.Length - 1)
        {
            value /= 1024;
            unit++;
        }

        return unit == 0 ? $"{value:0} {units[unit]}" : $"{value:0.0} {units[unit]}";
    }

    private void SelectLocalSection(object sender, RoutedEventArgs e)
    {
        var section = (sender as FrameworkElement)?.Tag?.ToString() ?? "Home";
        AddActivity($"{section} section focused inside Kira LC setup.", "info");
        StatusText.Text = section == "Modules" ? "Quick Text module is selected." : "Kira LC setup overview.";
        ProgressText.Text = "No external window opened.";
    }

    private void SelectQuickTextModule(object sender, RoutedEventArgs e)
    {
        SelectQuickTextModule();
    }

    private void SelectQuickTextModuleFromPanel(object sender, MouseButtonEventArgs e)
    {
        e.Handled = true;
        SelectQuickTextModule();
    }

    private void SelectQuickTextModule()
    {
        _sidebarModulePreviewPinned = false;
        SidebarModulePopup.IsOpen = false;
        RefreshInstallState();
        AddActivity("Quick Text module selected.", _installComplete ? "success" : "info");
        TransitionToState(
            GetInstalledReadyState(),
            _installComplete
                ? _updateAvailable ? "Quick Text has an update ready." : "Quick Text is installed and ready to launch."
                : "Quick Text module is ready to install.");
    }

    private void ShowComingSoon(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement target)
        {
            ShowSidebarModuleData(target, pinned: true);
        }

        ShowComingSoon((sender as FrameworkElement)?.Tag?.ToString() ?? "Module");
    }

    private void ShowComingSoonFromPanel(object sender, MouseButtonEventArgs e)
    {
        e.Handled = true;
        ShowComingSoon((sender as FrameworkElement)?.Tag?.ToString() ?? "Module");
    }

    private void ShowComingSoon(string moduleName)
    {
        var state = string.Equals(moduleName, "Auto Notification Barotem", StringComparison.OrdinalIgnoreCase)
            ? "Planned"
            : "Coming soon";

        AddActivity($"{moduleName} is {state.ToLowerInvariant()}. No external action was opened.", "warning");
        StatusText.Text = $"{moduleName}: {state}";
        ProgressText.Text = "Only Quick Text is active in this release.";
    }

    private void ShowSidebarModulePreview(object sender, System.Windows.Input.MouseEventArgs e)
    {
        if (sender is FrameworkElement target)
        {
            ShowSidebarModuleData(target, pinned: false);
        }
    }

    private void HideSidebarModulePreview(object sender, System.Windows.Input.MouseEventArgs e)
    {
        if (!_sidebarModulePreviewPinned)
        {
            SidebarModulePopup.IsOpen = false;
        }
    }

    private void ShowSidebarModuleData(FrameworkElement target, bool pinned)
    {
        var moduleName = target.Tag?.ToString() ?? "Module";
        var state = ReferenceEquals(target, BarotemNavButton) ? "Planned" : "Coming soon";

        _sidebarModulePreviewPinned = pinned;
        SidebarModuleTitleText.Text = moduleName;
        SidebarModuleStateText.Text = state;
        SidebarModuleStateText.Foreground = new SolidColorBrush(
            state == "Planned" ? MediaColor.FromRgb(214, 170, 79) : MediaColor.FromRgb(160, 168, 176));
        SidebarModulePopup.PlacementTarget = target;
        SidebarModulePopup.IsOpen = true;
    }

    private void OpenQuickTextFeature(object sender, MouseButtonEventArgs e)
    {
        e.Handled = true;
        var featureName = (sender as FrameworkElement)?.Tag?.ToString() ?? "Quick Text";
        if (!EnsureQuickTextInstalled(featureName))
        {
            return;
        }

        AddActivity($"Opening Quick Text for {featureName}.", "success");
        TransitionToState(SetupState.Launching, $"Opening {featureName} in Quick Text...");
        LaunchQuickText(featureName);
    }

    private bool EnsureQuickTextInstalled(string actionName)
    {
        RefreshInstallState();
        if (_installComplete)
        {
            return true;
        }

        AddActivity($"{actionName} requires Quick Text to be installed first.", "warning");
        TransitionToState(SetupState.Idle, "Install Quick Text before using module tools.");
        ProgressText.Text = "Use LAUNCH to install the module.";
        return false;
    }

    private void TransitionToState(SetupState state, string? detail = null)
    {
        _currentState = state;
        SetStatusDot(state);

        switch (state)
        {
            case SetupState.Idle:
                SetVisualState(MissingHeroSource, IdleCoreSource, IdleSceneSource);
                LaunchButtonLabel.Text = "INSTALL";
                StatusText.Text = detail ?? "Quick Text is not installed.";
                ProgressText.Text = "Waiting for launch confirmation";
                InstallProgress.Value = 0;
                StepText.Text = "Engine: embedded Quick Text setup core";
                QuickTextModuleState.Text = "Missing";
                break;
            case SetupState.Launching:
                SetVisualState(SuccessHeroSource, SuccessCoreSource, SuccessSceneSource);
                LaunchButtonLabel.Text = "LAUNCHING";
                StatusText.Text = detail ?? "Opening Quick Text...";
                ProgressText.Text = "Starting installed module";
                InstallProgress.Value = 100;
                StepText.Text = "Module launch requested: Quick Text";
                QuickTextModuleState.Text = "Active";
                break;
            case SetupState.Loading:
                SetVisualState(InstallHeroSource, ProgressCoreSource, ProgressSceneSource);
                LaunchButtonLabel.Text = "INSTALLING";
                StatusText.Text = detail ?? "Installing Quick Text module...";
                ProgressText.Text = "Preparing Kira LC setup engine";
                InstallProgress.Value = Math.Max(InstallProgress.Value, 6);
                StepText.Text = "Engine: deploying Quick Text setup core";
                QuickTextModuleState.Text = "Installing";
                break;
            case SetupState.Success:
                SetVisualState(SuccessHeroSource, SuccessCoreSource, SuccessSceneSource);
                LaunchButtonLabel.Text = "▶ LAUNCH";
                StatusText.Text = detail ?? "Quick Text is ready inside Kira LC.";
                ProgressText.Text = "Install complete";
                InstallProgress.Value = 100;
                StepText.Text = "Module ready: Quick Text";
                QuickTextModuleState.Text = "Active";
                break;
            case SetupState.UpdateAvailable:
                SetVisualState(UpdateHeroSource, UpdateCoreSource, UpdateSceneSource);
                LaunchButtonLabel.Text = "UPDATE";
                StatusText.Text = detail ?? "Quick Text update is ready.";
                ProgressText.Text = "Auto update can refresh the installed module";
                InstallProgress.Value = 100;
                StepText.Text = "Module update available: Quick Text";
                QuickTextModuleState.Text = "Update";
                break;
            case SetupState.Error:
                SetVisualState(ErrorHeroSource, ErrorCoreSource, ErrorSceneSource);
                LaunchButtonLabel.Text = "RETRY";
                StatusText.Text = detail ?? "Action failed.";
                InstallProgress.Value = Math.Min(InstallProgress.Value, 96);
                StepText.Text = "Module state: attention required";
                QuickTextModuleState.Text = "Error";
                break;
            case SetupState.Removing:
                SetVisualState(UninstallHeroSource, RemoveCoreSource, RemoveSceneSource);
                LaunchButtonLabel.Text = "REMOVING";
                StatusText.Text = detail ?? "Removing Quick Text module...";
                ProgressText.Text = "Removing files inside Kira LC";
                InstallProgress.Value = 18;
                StepText.Text = "Module removal requested: Quick Text";
                QuickTextModuleState.Text = "Removing";
                break;
        }

        UpdateActionAvailability();
    }

    private void RestoreCurrentStateVisual()
    {
        switch (_currentState)
        {
            case SetupState.Idle:
                SetVisualState(MissingHeroSource, IdleCoreSource, IdleSceneSource);
                break;
            case SetupState.Launching:
            case SetupState.Success:
                SetVisualState(SuccessHeroSource, SuccessCoreSource, SuccessSceneSource);
                break;
            case SetupState.UpdateAvailable:
                SetVisualState(UpdateHeroSource, UpdateCoreSource, UpdateSceneSource);
                break;
            case SetupState.Loading:
                SetVisualState(InstallHeroSource, ProgressCoreSource, ProgressSceneSource);
                break;
            case SetupState.Error:
                SetVisualState(ErrorHeroSource, ErrorCoreSource, ErrorSceneSource);
                break;
            case SetupState.Removing:
                SetVisualState(UninstallHeroSource, RemoveCoreSource, RemoveSceneSource);
                break;
        }
    }

    private void SetStatusDot(SetupState state)
    {
        var color = state switch
        {
            SetupState.Launching or SetupState.Success => MediaColor.FromRgb(56, 242, 122),
            SetupState.UpdateAvailable => MediaColor.FromRgb(255, 190, 42),
            SetupState.Loading or SetupState.Removing => MediaColor.FromRgb(214, 170, 79),
            SetupState.Error => MediaColor.FromRgb(255, 70, 85),
            _ => MediaColor.FromRgb(92, 200, 255),
        };

        StatusDot.Fill = new SolidColorBrush(color);
    }

    private void UpdateActionAvailability()
    {
        var busy = _installing || _currentState is SetupState.Loading or SetupState.Launching or SetupState.Removing;
        InstallButton.IsEnabled = !busy;
        InstallButton.Opacity = busy ? 0.64 : 1;
        InstallPathBox.IsEnabled = !busy;
        ActionMenuButton.IsEnabled = !busy;
        ActionMenuButton.Opacity = busy ? 0.58 : 1;
        InstallDialogPrimaryButton.IsEnabled = !busy;
        InstallDialogBrowseButton.IsEnabled = !busy;

        var isInstalled = _installComplete || IsQuickTextInstalled();
        _installComplete = isInstalled;
        _updateAvailable = isInstalled && IsUpdateAvailable();
        UpdateAutoUpdateIndicator();
        MenuInstallLabel.Text = _updateAvailable ? "Update Quick Text" : isInstalled ? "Repair Quick Text" : "Install Quick Text";
        InstallMenuButton.Tag = _updateAvailable ? "Update" : isInstalled ? "Repair" : "Install";
        LaunchMenuButton.IsEnabled = !busy && isInstalled;
        LaunchMenuButton.Opacity = !busy && isInstalled ? 1 : 0.42;
        RepairMenuButton.IsEnabled = !busy && isInstalled;
        RepairMenuButton.Opacity = !busy && isInstalled ? 1 : 0.42;
        UninstallMenuButton.IsEnabled = !busy && isInstalled;
        UninstallMenuButton.Opacity = !busy && isInstalled ? 1 : 0.42;
        InstallStateButton.Opacity = busy ? 0.55 : 1;
        RemoveStateButton.Opacity = !busy && isInstalled ? 1 : 0.45;
        ReadyStateButton.Opacity = !busy && isInstalled ? 1 : 0.45;
        ErrorStateButton.Opacity = !busy && _currentState == SetupState.Error ? 1 : 0.45;

        ModuleCardPanel.Opacity = busy ? 0.58 : 1;
        HotkeyCardPanel.Opacity = busy ? 0.58 : 1;
        ClipboardCardPanel.Opacity = busy ? 0.58 : 1;
    }

    private void WarmImageCache()
    {
        foreach (var source in new[]
        {
            MissingHeroSource,
            InstallHeroSource,
            UninstallHeroSource,
            SuccessHeroSource,
            UpdateHeroSource,
            ErrorHeroSource,
            IdleCoreSource,
            ProgressCoreSource,
            SuccessCoreSource,
            UpdateCoreSource,
            RemoveCoreSource,
            ErrorCoreSource,
            IdleSceneSource,
            ProgressSceneSource,
            SuccessSceneSource,
            UpdateSceneSource,
            RemoveSceneSource,
            ErrorSceneSource,
        })
        {
            _ = GetCachedImage(source);
        }
    }

    private BitmapImage GetCachedImage(string source)
    {
        if (_imageCache.TryGetValue(source, out var cached))
        {
            return cached;
        }

        var image = LoadAssetImage(source);
        _imageCache[source] = image;
        return image;
    }

    private void SetVisualState(string heroSource, string coreSource, string sceneSource, bool animate = true)
    {
        SetHeroImage(heroSource, animate);
        SetCoreImage(coreSource, animate);
        SetSceneImage(sceneSource, animate);
    }

    private void SetHeroImage(string source, bool animate = true)
    {
        if (string.Equals(_currentHeroSource, source, StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        _currentHeroSource = source;
        CrossfadeImage(HeroImageA, HeroImageB, source, ref _showingHeroA, animate, 1);
    }

    private void SetCoreImage(string source, bool animate = true)
    {
        if (string.Equals(_currentCoreSource, source, StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        _currentCoreSource = source;
        CrossfadeImage(CoreImageA, CoreImageB, source, ref _showingCoreA, animate, 1);
    }

    private void SetSceneImage(string source, bool animate = true)
    {
        if (string.Equals(_currentSceneSource, source, StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        _currentSceneSource = source;
        CrossfadeImage(SceneImageA, SceneImageB, source, ref _showingSceneA, animate, 0.42);
    }

    private void CrossfadeImage(System.Windows.Controls.Image imageA, System.Windows.Controls.Image imageB, string source, ref bool showingA, bool animate, double targetOpacity)
    {
        var nextImage = showingA ? imageB : imageA;
        var currentImage = showingA ? imageA : imageB;

        nextImage.Source = GetCachedImage(source);
        System.Windows.Controls.Panel.SetZIndex(nextImage, 2);
        System.Windows.Controls.Panel.SetZIndex(currentImage, 1);

        if (!animate)
        {
            nextImage.Opacity = targetOpacity;
            currentImage.Opacity = 0;
            showingA = !showingA;
            return;
        }

        nextImage.Opacity = 0;
        AnimateOpacity(nextImage, targetOpacity, StateCrossfadeDurationMs);
        AnimateOpacity(currentImage, 0, StateCrossfadeDurationMs);
        showingA = !showingA;
    }

    private static void AnimateOpacity(UIElement element, double to, int durationMs)
    {
        var animation = new DoubleAnimation
        {
            To = to,
            Duration = TimeSpan.FromMilliseconds(durationMs),
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
        };
        element.BeginAnimation(OpacityProperty, animation, HandoffBehavior.SnapshotAndReplace);
    }

    private static BitmapImage LoadAssetImage(string source)
    {
        var image = new BitmapImage();
        image.BeginInit();
        image.CacheOption = BitmapCacheOption.OnLoad;
        image.CreateOptions = BitmapCreateOptions.IgnoreImageCache;
        image.UriSource = new Uri(source, UriKind.Absolute);
        image.EndInit();
        image.Freeze();
        return image;
    }

    private bool IsQuickTextInstalled()
    {
        return File.Exists(GetQuickTextExecutablePath());
    }

    private bool IsUpdateAvailable()
    {
        var executablePath = GetQuickTextExecutablePath();
        if (!File.Exists(executablePath))
        {
            return false;
        }

        try
        {
            var packageVersion = typeof(MainWindow).Assembly.GetName().Version;
            if (packageVersion is null)
            {
                return false;
            }

            var versionInfo = FileVersionInfo.GetVersionInfo(executablePath);
            var installedVersionText = versionInfo.ProductVersion ?? versionInfo.FileVersion;
            if (!TryParseVersion(installedVersionText, out var installedVersion))
            {
                return false;
            }

            return installedVersion < packageVersion;
        }
        catch (Exception)
        {
            return false;
        }
    }

    private static bool TryParseVersion(string? text, out Version version)
    {
        version = new Version(0, 0, 0, 0);
        if (string.IsNullOrWhiteSpace(text))
        {
            return false;
        }

        var versionText = new string(text.TakeWhile(character => char.IsDigit(character) || character == '.').ToArray());
        if (!Version.TryParse(versionText.TrimEnd('.'), out var parsedVersion))
        {
            return false;
        }

        version = parsedVersion;
        return true;
    }

    private string GetQuickTextExecutablePath()
    {
        return Path.Combine(InstallPathBox.Text, "QuickText.exe");
    }

    private bool LaunchQuickText(string source)
    {
        var executablePath = GetQuickTextExecutablePath();
        if (!File.Exists(executablePath))
        {
            _installComplete = false;
            AddActivity("Launch failed: QuickText.exe was not found.", "error");
            TransitionToState(SetupState.Error, "QuickText.exe was not found.");
            ProgressText.Text = "The selected folder does not contain QuickText.exe.";
            System.Windows.MessageBox.Show(
                "QuickText.exe was not found in the selected install directory.",
                "Kira LC Setup",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
            return false;
        }

        try
        {
            Process.Start(new ProcessStartInfo(executablePath)
            {
                UseShellExecute = true,
                WorkingDirectory = Path.GetDirectoryName(executablePath) ?? InstallPathBox.Text,
            });
            AddActivity($"Quick Text launched from {source}.", "success");
            Close();
            return true;
        }
        catch (Exception error)
        {
            AddActivity($"Launch failed: {error.Message}", "error");
            TransitionToState(SetupState.Error, "Launch failed.");
            ProgressText.Text = error.Message;
            System.Windows.MessageBox.Show(
                error.Message,
                "Kira LC Setup",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            return false;
        }
    }

    private void AddActivity(string message, string tone)
    {
        var timestamp = DateTime.Now.ToString("HH:mm:ss");
        var item = new Border
        {
            CornerRadius = new CornerRadius(10),
            Background = new SolidColorBrush(MediaColor.FromArgb(28, 255, 255, 255)),
            BorderBrush = new SolidColorBrush(MediaColor.FromArgb(20, 255, 255, 255)),
            BorderThickness = new Thickness(1),
            Margin = new Thickness(0, 0, 0, 8),
            Padding = new Thickness(10, 7, 10, 7),
        };

        var stack = new StackPanel();
        stack.Children.Add(new TextBlock
        {
            Text = timestamp,
            Foreground = new SolidColorBrush(MediaColor.FromArgb(150, 255, 255, 255)),
            FontFamily = new MediaFontFamily("Bahnschrift"),
            FontSize = 10,
            FontWeight = FontWeights.Bold,
        });
        stack.Children.Add(new TextBlock
        {
            Text = message,
            Foreground = ActivityBrush(tone),
            FontFamily = new MediaFontFamily("Segoe UI"),
            FontSize = 11,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 2, 0, 0),
        });

        item.Child = stack;
        ActivityLogPanel.Children.Insert(0, item);

        while (ActivityLogPanel.Children.Count > MaxActivityEntries)
        {
            ActivityLogPanel.Children.RemoveAt(ActivityLogPanel.Children.Count - 1);
        }
    }

    private static MediaBrush ActivityBrush(string tone)
    {
        return tone switch
        {
            "success" => new SolidColorBrush(MediaColor.FromRgb(31, 219, 255)),
            "warning" => new SolidColorBrush(MediaColor.FromRgb(214, 170, 79)),
            "error" => new SolidColorBrush(MediaColor.FromRgb(255, 70, 85)),
            _ => new SolidColorBrush(MediaColor.FromArgb(220, 255, 255, 255)),
        };
    }
}
