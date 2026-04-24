using System.Diagnostics;
using System.IO;
using System.Reflection;

namespace QuickText.Setup;

internal static class InstallerEngine
{
    private const string EmbeddedEngineName = "QuickTextSetupEngine.exe";

    internal static string ResolveOrExtract()
    {
        var baseDirectory = AppContext.BaseDirectory;
        var sideBySideEngine = Directory
            .EnumerateFiles(baseDirectory, "QuickText-Setup-*.exe", SearchOption.TopDirectoryOnly)
            .FirstOrDefault(path => !Path.GetFileName(path).Equals("QuickText.Setup.exe", StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrWhiteSpace(sideBySideEngine))
        {
            return sideBySideEngine;
        }

        var assembly = Assembly.GetExecutingAssembly();
        using var stream = assembly.GetManifestResourceStream(EmbeddedEngineName);
        if (stream is null)
        {
            throw new InvalidOperationException("Missing embedded Quick Text setup engine.");
        }

        var engineDirectory = Path.Combine(Path.GetTempPath(), "QuickText", "SetupEngine");
        Directory.CreateDirectory(engineDirectory);
        var enginePath = Path.Combine(engineDirectory, EmbeddedEngineName);
        using var fileStream = File.Create(enginePath);
        stream.CopyTo(fileStream);
        return enginePath;
    }

    internal static async Task<int> RunSilentInstallAsync(string installDirectory, IProgress<double> progress, CancellationToken cancellationToken)
    {
        var enginePath = ResolveOrExtract();
        var arguments = BuildArguments(installDirectory);
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo(enginePath)
            {
                Arguments = arguments,
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            },
            EnableRaisingEvents = true,
        };

        if (!process.Start())
        {
            throw new InvalidOperationException("Could not start Quick Text setup engine.");
        }

        var simulatedProgress = 0.08;
        while (!process.HasExited)
        {
            cancellationToken.ThrowIfCancellationRequested();
            simulatedProgress = Math.Min(0.92, simulatedProgress + 0.018);
            progress.Report(simulatedProgress);
            await Task.Delay(260, cancellationToken).ConfigureAwait(false);
        }

        progress.Report(1);
        return process.ExitCode;
    }

    private static string BuildArguments(string installDirectory)
    {
        var cleanDirectory = string.IsNullOrWhiteSpace(installDirectory)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Quick Text")
            : installDirectory.Trim();

        return $"/S /D={cleanDirectory}";
    }
}
