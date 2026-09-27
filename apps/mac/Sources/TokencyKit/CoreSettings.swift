import Foundation

public struct CoreEndpoint: Sendable, Equatable {
  public var port: Int
  public var token: String

  public var eventsURL: URL { URL(string: "http://127.0.0.1:\(port)/v1/events")! }
}

public enum CoreSettingsError: Error, LocalizedError, Equatable {
  case missingToken

  public var errorDescription: String? {
    switch self {
    case .missingToken: "No hay token en el Llavero; ejecuta `tokency install`."
    }
  }
}

/// Ubicaciones y credenciales del core, las mismas que usa el CLI (`packages/core/src/paths.ts`).
public enum CoreSettings {
  public static let defaultPort = 7777
  public static let launchAgentLabel = "com.tokency.core"
  static let tokenService = "com.tokency.core"
  static let tokenAccount = "api-token"

  public static func supportDirectory(home: URL) -> URL {
    home.appending(path: "Library/Application Support/Tokency", directoryHint: .isDirectory)
  }

  public static func logFile(home: URL) -> URL {
    home.appending(path: "Library/Logs/Tokency/core.log")
  }

  /// Puerto de `config.json`; `TOKENCY_PORT` lo reemplaza en pruebas locales.
  public static func port(home: URL, environment: [String: String]) -> Int {
    if let override = environment["TOKENCY_PORT"].flatMap(Int.init) { return override }
    let file = supportDirectory(home: home).appending(path: "config.json")
    guard
      let data = try? Data(contentsOf: file),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let port = json["port"] as? Int, port > 0
    else { return defaultPort }
    return port
  }

  /// Lee el token con `/usr/bin/security` y no con el framework Security, para evitar diálogos
  /// de acceso después de cada recompilación con firma local (D-013). `TOKENCY_TOKEN` lo
  /// reemplaza en pruebas locales.
  public static func token(environment: [String: String]) throws -> String {
    if let override = environment["TOKENCY_TOKEN"], !override.isEmpty { return override }
    let process = Process()
    process.executableURL = URL(filePath: "/usr/bin/security")
    process.arguments = ["find-generic-password", "-a", tokenAccount, "-s", tokenService, "-w"]
    let output = Pipe()
    process.standardOutput = output
    process.standardError = Pipe()
    try process.run()
    let data = output.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    let token = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    guard process.terminationStatus == 0, !token.isEmpty else { throw CoreSettingsError.missingToken }
    return token
  }

  public static func endpoint(
    home: URL = FileManager.default.homeDirectoryForCurrentUser,
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) throws -> CoreEndpoint {
    CoreEndpoint(port: port(home: home, environment: environment), token: try token(environment: environment))
  }
}

/// Tiempo transcurrido legible, igual que `tokency status`.
public func elapsedLabel(since start: Date, now: Date) -> String {
  let minutes = Int(now.timeIntervalSince(start) / 60)
  if minutes < 1 { return "<1 min" }
  if minutes < 60 { return "\(minutes) min" }
  let hours = minutes / 60
  if hours < 24 { return "\(hours) h \(minutes % 60) min" }
  return "\(hours / 24) d \(hours % 24) h"
}
