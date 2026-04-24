using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media.Imaging;
using Forms = System.Windows.Forms;

namespace QuickText.Setup;

public partial class MainWindow
{
    private readonly string _defaultInstallPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Programs",
        "Quick Text");

    private bool _installComplete;
    private bool _installing;
    private const string InstallHeroSource = "pack://application:,,,/Assets/install-hero.png";
    private const string SuccessHeroSource = "pack://application:,,,/Assets/success-hero.png";
    private const string ErrorHeroSource = "pack://application:,,,/Assets/error-hero.png";

    public MainWindow()
    {
        InitializeComponent();
        InstallPathBox.Text = _defaultInstallPath;
    }

    private void DragWindow(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left)
        {
            DragMove();
        }
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

    private void BrowseInstallPath(object sender, RoutedEventArgs e)
    {
        if (_installing)
        {
            return;
        }

        using var dialog = new Forms.FolderBrowserDialog
        {
            Description = "Choose where Kira LC installs the Quick Text module.",
            SelectedPath = Directory.Exists(InstallPathBox.Text) ? InstallPathBox.Text : _defaultInstallPath,
            UseDescriptionForTitle = true,
        };

        if (dialog.ShowDialog() == Forms.DialogResult.OK)
        {
            InstallPathBox.Text = dialog.SelectedPath;
        }
    }

    private async void InstallOrLaunch(object sender, RoutedEventArgs e)
    {
        if (_installing)
        {
            return;
        }

        if (_installComplete)
        {
            LaunchQuickText();
            return;
        }

        await InstallQuickTextAsync().ConfigureAwait(true);
    }

    private async Task InstallQuickTextAsync()
    {
        _installing = true;
        InstallButton.IsEnabled = false;
        InstallPathBox.IsEnabled = false;
        HeroImage.Source = LoadAssetImage(InstallHeroSource);
        ModuleCardImage.Opacity = 1;
        StatusText.Text = "Installing Quick Text module...";
        ProgressText.Text = "Preparing Kira LC setup engine";
        InstallProgress.Value = 6;

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
            HeroImage.Source = LoadAssetImage(SuccessHeroSource);
            ModuleCardImage.Opacity = 0;
            StatusText.Text = "Quick Text is ready inside Kira LC.";
            ProgressText.Text = "Install complete";
            StepText.Text = "Module installed: Quick Text";
            InstallButton.Content = "Launch Quick Text";
        }
        catch (Exception error)
        {
            StatusText.Text = "Install failed.";
            HeroImage.Source = LoadAssetImage(ErrorHeroSource);
            ModuleCardImage.Opacity = 0;
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
            InstallButton.IsEnabled = true;
            InstallPathBox.IsEnabled = true;
        }
    }

    private static BitmapImage LoadAssetImage(string source)
    {
        return new BitmapImage(new Uri(source, UriKind.Absolute));
    }

    private void LaunchQuickText()
    {
        var executablePath = Path.Combine(InstallPathBox.Text, "QuickText.exe");
        if (!File.Exists(executablePath))
        {
            System.Windows.MessageBox.Show(
                "QuickText.exe was not found in the selected install directory.",
                "Kira LC Setup",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
            return;
        }

        Process.Start(new ProcessStartInfo(executablePath)
        {
            UseShellExecute = true,
            WorkingDirectory = Path.GetDirectoryName(executablePath) ?? InstallPathBox.Text,
        });
        Close();
    }
}
