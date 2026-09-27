import Foundation

public enum CoreAPIError: Error, LocalizedError {
  case status(Int)

  public var errorDescription: String? {
    switch self {
    case .status(let code): "El core respondió \(code)."
    }
  }
}

/// Consultas puntuales a la API local (el flujo en vivo va por `/v1/events`).
public struct CoreAPI: Sendable {
  public let endpoint: CoreEndpoint

  public init(endpoint: CoreEndpoint) {
    self.endpoint = endpoint
  }

  private func request<T: Decodable>(_ path: String, method: String = "GET") async throws -> T {
    var request = URLRequest(url: URL(string: "http://127.0.0.1:\(endpoint.port)\(path)")!)
    request.httpMethod = method
    request.timeoutInterval = 10
    request.setValue("Bearer \(endpoint.token)", forHTTPHeaderField: "Authorization")
    let (data, response) = try await URLSession.shared.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else { throw CoreAPIError.status(status) }
    return try JSONDecoder().decode(T.self, from: data)
  }

  private struct Days: Decodable { let days: [DailyUsage] }
  private struct Projects: Decodable { let projects: [ProjectUsage] }
  private struct Windows: Decodable { let windows: [WindowSummary] }

  public func daily(days: Int) async throws -> [DailyUsage] {
    try await (request("/v1/usage/daily?days=\(days)") as Days).days
  }

  public func projects(days: Int) async throws -> [ProjectUsage] {
    try await (request("/v1/usage/projects?days=\(days)") as Projects).projects
  }

  public func windows(days: Int) async throws -> [WindowSummary] {
    try await (request("/v1/usage/windows?days=\(days)") as Windows).windows
  }

  /// Botón "Llegué al límite": agrega una muestra de calibración.
  public func markLimitHit() async throws -> UsageSummary {
    try await request("/v1/usage/limit-hit", method: "POST")
  }
}
