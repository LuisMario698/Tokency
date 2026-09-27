import Foundation

/// Cómo llevar al usuario a la sesión exacta al hacer clic en su banda.
public enum FocusPlan: Equatable, Sendable {
  /// Selecciona la pestaña de la terminal cuyo `tty` es el del proceso `claude`.
  case terminalTab(bundleId: String, script: String)
  /// Abre la carpeta del proyecto con el IDE (enfoca su ventana) y, si hay, la URI de la sesión.
  case ideWindow(bundleId: String, folder: String, sessionURL: URL?)
  /// Solo trae la app al frente.
  case activate(bundleId: String)
  case none
}

public enum SessionFocus {
  /// Solo rutas como `/dev/ttys003`: el valor se inserta en un AppleScript.
  public static func isSafeTTY(_ tty: String) -> Bool {
    guard tty.hasPrefix("/dev/tty") else { return false }
    var rest = tty.dropFirst("/dev/tty".count)
    if rest.hasPrefix("s") { rest = rest.dropFirst() }
    return (1...4).contains(rest.count) && rest.allSatisfy { $0.isASCII && $0.isNumber }
  }

  /// URI oficial de la extensión de Claude Code: enfoca la pestaña de la sesión si ya está abierta.
  /// https://code.claude.com/docs/en/vs-code#launch-a-vs-code-tab-from-other-tools
  public static func extensionSessionURL(scheme: String, sessionId: String) -> URL? {
    var components = URLComponents()
    components.scheme = scheme
    components.host = "anthropic.claude-code"
    components.path = "/open"
    components.queryItems = [URLQueryItem(name: "session", value: sessionId)]
    return components.url
  }

  /// Primer esquema de URL propio de una app (descarta los de inicio de sesión de Microsoft).
  public static func primaryURLScheme(infoDictionary: [String: Any]?) -> String? {
    let types = infoDictionary?["CFBundleURLTypes"] as? [[String: Any]] ?? []
    return types.flatMap { $0["CFBundleURLSchemes"] as? [String] ?? [] }.first { !$0.hasPrefix("msauth") }
  }

  public static func terminalScript(bundleId: String, tty: String) -> String? {
    guard isSafeTTY(tty) else { return nil }
    switch bundleId {
    case "com.apple.Terminal":
      return """
        tell application id "com.apple.Terminal"
          repeat with w in windows
            repeat with t in tabs of w
              if tty of t is "\(tty)" then
                set selected tab of w to t
                set index of w to 1
                activate
                return true
              end if
            end repeat
          end repeat
        end tell
        return false
        """
    case "com.googlecode.iterm2":
      return """
        tell application id "com.googlecode.iterm2"
          repeat with w in windows
            repeat with t in tabs of w
              repeat with s in sessions of t
                if tty of s is "\(tty)" then
                  select w
                  tell t to select
                  tell s to select
                  activate
                  return true
                end if
              end repeat
            end repeat
          end repeat
        end tell
        return false
        """
    default:
      return nil
    }
  }

  /// Decide cómo enfocar la sesión. `urlScheme` devuelve el esquema de la app con ese bundle id.
  public static func plan(for session: Session, urlScheme: (String) -> String?) -> FocusPlan {
    guard let bundleId = session.origin.bundleId else { return .none }
    if let tty = session.tty, let script = terminalScript(bundleId: bundleId, tty: tty) {
      return .terminalTab(bundleId: bundleId, script: script)
    }
    let inIDE = session.origin.kind == .ide || session.origin.termProgram == "vscode"
    if inIDE, let folder = session.projectDir {
      // La URI solo sirve para la extensión; una sesión en la terminal integrada no tiene pestaña propia.
      let url =
        session.origin.kind == .ide
        ? urlScheme(bundleId).flatMap { extensionSessionURL(scheme: $0, sessionId: session.sessionId) }
        : nil
      return .ideWindow(bundleId: bundleId, folder: folder, sessionURL: url)
    }
    return .activate(bundleId: bundleId)
  }
}
