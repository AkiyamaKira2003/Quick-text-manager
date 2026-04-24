using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
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
    private bool _showingHeroA = true;
    private bool _showingCoreA = true;
    private bool _showingSceneA = true;
    private SetupState _currentState = SetupState.Idle;
    private string? _currentHeroSource;
    private string? _currentCoreSource;
    private string? _currentSceneSource;

    private const string InstallHeroSource = "pack://application:,,,/Assets/install-hero-alpha.png";
    private const string UninstallHeroSource = "pack://application:,,,/Assets/uninstall-hero-alpha.png";
    private const string SuccessHeroSource = "pack://application:,,,/Assets/success-hero-alpha.png";
    private const string ErrorHeroSource = "pack://application:,,,/Assets/error-hero-alpha.png";
    private const string ProgressCoreSource = "pack://application:,,,/Assets/progress-core.png";
    private const string SuccessCoreSource = "pack://application:,,,/Assets/success-core.png";
    private const string ErrorCoreSource = "pack://application:,,,/Assets/error-core.png";
    private const string ProgressSceneSource = "pack://application:,,,/Assets/progress-scene.png";
    private const string SuccessSceneSource = "pack://application:,,,/Assets/success-scene.png";
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

        _installComplete = IsQuickTextInstalled();
        AddActivity("Kira LC setup shell ready.", "info");
        TransitionToState(
            _installComplete ? SetupState.Success : SetupState.Idle,
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

        _installComplete = IsQuickTextInstalled();
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
        _installComplete = IsQuickTextInstalled();
        AddActivity($"Install path set: {dialog.SelectedPath}", "info");
        TransitionToState(
            _installComplete ? SetupState.Success : SetupState.Idle,
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

    private void InstallOrLaunch(object sender, RoutedEventArgs e)
    {
        if (_installing)
        {
            return;
        }

        _installComplete = IsQuickTextInstalled();
        if (_installComplete)
        {
            AddActivity("Launch requested from primary button.", "info");
            TransitionToState(SetupState.Launching, "Opening Quick Text...");
            LaunchQuickText("primary launch");
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
        _installComplete = IsQuickTextInstalled();
        _installDialogRepairMode = repairMode || _installComplete;
        SyncInstallPathPreview();

        InstallDialogTitle.Text = _installDialogRepairMode ? "Repair Quick Text" : "Install Quick Text";
        InstallDialogBody.Text = _installDialogRepairMode
            ? "Quick Text is already installed at the path below. Repair will refresh the files in this folder."
            : "Quick Text will be installed to the default path below. You can choose a custom folder before downloading.";
        InstallDialogPrimaryLabel.Text = _installDialogRepairMode ? "REPAIR" : "TẢI VỀ";
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
        _installComplete = IsQuickTextInstalled();

        if (action == "Primary")
        {
            action = _installComplete ? "Launch" : "Install";
        }
        else if (ReferenceEquals(sender, InstallMenuButton) && _installComplete)
        {
            action = "Repair";
        }

        switch (action)
        {
            case "Install":
                SetVisualState(InstallHeroSource, ProgressCoreSource, ProgressSceneSource);
                break;
            case "Launch":
            case "Repair":
                SetVisualState(SuccessHeroSource, SuccessCoreSource, SuccessSceneSource);
                break;
            case "Uninstall":
                SetVisualState(UninstallHeroSource, ProgressCoreSource, ProgressSceneSource);
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

        try
        {
            var progress = new Progress<double>(value =>
            {
                InstallProgress.Value = Math.Max(6, Math.Min(100, value * 100));
                ProgressText.Text = value < 0.92 ? "Deploying files and shortcuts" : "Finalizing install";
            });

            var exitCode = await InstallerEngine
                .RunSilentInstallAsync(InstallPathBox.Text, progress, CancellationToken.None)
                .ConfigureAwait(true);

            if (exitCode != 0)
            {
                throw new InvalidOperationException($"Quick Text setup engine exited with code {exitCode}.");
            }

            _installComplete = true;
            InstallProgress.Value = 100;
            AddActivity("Install complete. Quick Text is ready.", "success");
            TransitionToState(SetupState.Success, "Quick Text is ready inside Kira LC.");
        }
        catch (Exception error)
        {
            _installComplete = false;
            AddActivity($"Install failed: {error.Message}", "error");
            TransitionToState(SetupState.Error, "Install failed.");
            ProgressText.Text = error.Message;
            System.Windows.MessageBox.Show(
                error.Message,
                "Kira LC Setup",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
        }
        finally
        {
            _installing = false;
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

        if (IsQuickTextInstalled())
        {
            _installComplete = true;
            AddActivity("Install card selected: Quick Text is already installed.", "success");
            TransitionToState(SetupState.Success, "Quick Text is already installed.");
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

        _installComplete = IsQuickTextInstalled();
        if (!_installComplete)
        {
            AddActivity("Remove requested but Quick Text is not installed.", "warning");
            TransitionToState(SetupState.Idle, "Nothing to remove. Quick Text is not installed.");
            return;
        }

        var uninstallerPath = FindUninstallerPath();
        if (uninstallerPath is null)
        {
            AddActivity("Remove failed: uninstaller was not found.", "error");
            TransitionToState(SetupState.Error, "Uninstaller not found.");
            ProgressText.Text = "Could not find the NSIS uninstaller in the selected install folder.";
            System.Windows.MessageBox.Show(
                "Could not find the Quick Text uninstaller in the selected install folder.",
                "Kira LC Setup",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
            return;
        }

        var confirm = System.Windows.MessageBox.Show(
            "Remove Quick Text from this Kira LC install path?",
            "Kira LC Setup",
            MessageBoxButton.YesNo,
            MessageBoxImage.Question);

        if (confirm != MessageBoxResult.Yes)
        {
            AddActivity("Remove cancelled by user.", "info");
            return;
        }

        _installing = true;
        AddActivity("Remove started.", "info");
        TransitionToState(SetupState.Removing, "Removing Quick Text module...");

        try
        {
            using var process = Process.Start(new ProcessStartInfo(uninstallerPath)
            {
                UseShellExecute = true,
                WorkingDirectory = Path.GetDirectoryName(uninstallerPath) ?? InstallPathBox.Text,
            });

            if (process is null)
            {
                throw new InvalidOperationException("Could not start the Quick Text uninstaller.");
            }

            await process.WaitForExitAsync().ConfigureAwait(true);
            _installComplete = IsQuickTextInstalled();

            if (_installComplete)
            {
                AddActivity("Remove finished but Quick Text still exists. The uninstall may have been cancelled.", "warning");
                TransitionToState(SetupState.Success, "Quick Text is still installed.");
                return;
            }

            AddActivity("Quick Text removed.", "success");
            TransitionToState(SetupState.Idle, "Quick Text removed. Ready to install again.");
        }
        catch (Exception error)
        {
            AddActivity($"Remove failed: {error.Message}", "error");
            TransitionToState(SetupState.Error, "Remove failed.");
            ProgressText.Text = error.Message;
            System.Windows.MessageBox.Show(
                error.Message,
                "Kira LC Setup",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
        }
        finally
        {
            _installing = false;
            UpdateActionAvailability();
        }
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
        _installComplete = IsQuickTextInstalled();
        AddActivity("Quick Text module selected.", _installComplete ? "success" : "info");
        TransitionToState(
            _installComplete ? SetupState.Success : SetupState.Idle,
            _installComplete ? "Quick Text is installed and ready to launch." : "Quick Text module is ready to install.");
    }

    private void ShowComingSoon(object sender, RoutedEventArgs e)
    {
        ShowComingSoon((sender as FrameworkElement)?.Tag?.ToString() ?? "Module");
    }

    private void ShowComingSoonFromPanel(object sender, MouseButtonEventArgs e)
    {
        e.Handled = true;
        ShowComingSoon((sender as FrameworkElement)?.Tag?.ToString() ?? "Module");
    }

    private void ShowComingSoon(string moduleName)
    {
        AddActivity($"{moduleName} is coming soon. No external action was opened.", "warning");
        StatusText.Text = $"{moduleName} is coming soon.";
        ProgressText.Text = "Only Quick Text is active in this release.";
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
        _installComplete = IsQuickTextInstalled();
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
                SetVisualState(UninstallHeroSource, ProgressCoreSource, ProgressSceneSource);
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
            case SetupState.Error:
                SetVisualState(ErrorHeroSource, ErrorCoreSource, ErrorSceneSource);
                LaunchButtonLabel.Text = "RETRY";
                StatusText.Text = detail ?? "Action failed.";
                InstallProgress.Value = Math.Min(InstallProgress.Value, 96);
                StepText.Text = "Module state: attention required";
                QuickTextModuleState.Text = "Error";
                break;
            case SetupState.Removing:
                SetVisualState(UninstallHeroSource, ProgressCoreSource, ProgressSceneSource);
                LaunchButtonLabel.Text = "REMOVING";
                StatusText.Text = detail ?? "Removing Quick Text module...";
                ProgressText.Text = "Waiting for the uninstaller";
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
                SetVisualState(UninstallHeroSource, ProgressCoreSource, ProgressSceneSource);
                break;
            case SetupState.Launching:
            case SetupState.Success:
                SetVisualState(SuccessHeroSource, SuccessCoreSource, SuccessSceneSource);
                break;
            case SetupState.Loading:
                SetVisualState(InstallHeroSource, ProgressCoreSource, ProgressSceneSource);
                break;
            case SetupState.Error:
                SetVisualState(ErrorHeroSource, ErrorCoreSource, ErrorSceneSource);
                break;
            case SetupState.Removing:
                SetVisualState(UninstallHeroSource, ProgressCoreSource, ProgressSceneSource);
                break;
        }
    }

    private void SetStatusDot(SetupState state)
    {
        var color = state switch
        {
            SetupState.Launching or SetupState.Success => MediaColor.FromRgb(56, 242, 122),
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
        MenuInstallLabel.Text = isInstalled ? "Repair Quick Text" : "Install Quick Text";
        InstallMenuButton.Tag = isInstalled ? "Repair" : "Install";
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
            InstallHeroSource,
            UninstallHeroSource,
            SuccessHeroSource,
            ErrorHeroSource,
            ProgressCoreSource,
            SuccessCoreSource,
            ErrorCoreSource,
            ProgressSceneSource,
            SuccessSceneSource,
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
        CrossfadeImage(SceneImageA, SceneImageB, source, ref _showingSceneA, animate, 0.62);
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

    private string GetQuickTextExecutablePath()
    {
        return Path.Combine(InstallPathBox.Text, "QuickText.exe");
    }

    private string? FindUninstallerPath()
    {
        var installPath = InstallPathBox.Text;
        if (string.IsNullOrWhiteSpace(installPath) || !Directory.Exists(installPath))
        {
            return null;
        }

        foreach (var candidate in new[]
        {
            "Uninstall Quick Text.exe",
            "Uninstall QuickText.exe",
            "Quick Text Uninstaller.exe",
            "Uninstall.exe",
        })
        {
            var candidatePath = Path.Combine(installPath, candidate);
            if (File.Exists(candidatePath))
            {
                return candidatePath;
            }
        }

        return Directory
            .EnumerateFiles(installPath, "Uninstall*.exe", SearchOption.TopDirectoryOnly)
            .OrderBy(path => Path.GetFileName(path).Length)
            .FirstOrDefault();
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
