import AppKit
import ServiceManagement
import TokencyKit

/// Acciones sobre el sistema: apps de origen, el LaunchAgent del core y el ítem de inicio.
@MainActor
enum SystemActions {
  private static var appNames: [String: String] = [:]

  /// Trae al frente la app donde corre la sesión (spec §4.9).
  static func activateApp(bundleId: String?) {
    guard let bundleId,
      let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first
    else { return }
    app.activate()
  }

  /// Nombre visible de una app a partir de su bundle id, por ejemplo "Terminal".
  static func appName(bundleId: String?) -> String? {
    guard let bundleId else { return nil }
    if let cached = appNames[bundleId] { return cached }
    guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else { return nil }
    let name = FileManager.default.displayName(atPath: url.path).replacingOccurrences(of: ".app", with: "")
    appNames[bundleId] = name
    return name
  }

  static func originLabel(_ session: Session) -> String {
    if let name = appName(bundleId: session.origin.bundleId) { return name }
    switch session.origin.kind {
    case .cli: return "Terminal"
    case .ide: return "IDE"
    case .desktop: return "Claude"
    case .unknown: return "Origen desconocido"
    }
  }

  /// `launchctl kickstart -k`: reinicia el core aunque esté colgado.
  static func restartCore() {
    let process = Process()
    process.executableURL = URL(filePath: "/bin/launchctl")
    process.arguments = ["kickstart", "-k", "gui/\(getuid())/\(CoreSettings.launchAgentLabel)"]
    try? process.run()
  }

  static func openCoreLog() {
    NSWorkspace.shared.open(CoreSettings.logFile(home: FileManager.default.homeDirectoryForCurrentUser))
  }
}

/// Arranque al iniciar sesión con `SMAppService` (spec §4.9).
@MainActor
enum LoginItem {
  private static let autoRegisteredKey = "loginItemAutoRegistered"

  static var isEnabled: Bool { SMAppService.mainApp.status == .enabled }
  static var needsApproval: Bool { SMAppService.mainApp.status == .requiresApproval }

  static func setEnabled(_ enabled: Bool) throws {
    if enabled {
      try SMAppService.mainApp.register()
    } else {
      try SMAppService.mainApp.unregister()
    }
  }

  /// La primera vez que se abre la app instalada se registra sola; después manda lo que elija
  /// el usuario. Una copia de desarrollo (fuera de una carpeta Applications) nunca se registra.
  static func registerOnFirstLaunch() {
    let defaults = UserDefaults.standard
    let installed = Bundle.main.bundlePath.contains("/Applications/")
    guard installed, !defaults.bool(forKey: autoRegisteredKey), Bundle.main.bundleIdentifier != nil else {
      return
    }
    defaults.set(true, forKey: autoRegisteredKey)
    try? setEnabled(true)
  }
}
