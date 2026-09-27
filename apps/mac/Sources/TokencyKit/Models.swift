import Foundation

/// Estados de sesión del core (`packages/shared/src/schemas.ts`, D-014).
public enum SessionState: String, Codable, Sendable, CaseIterable {
  case working, waiting, done, idle, ended

  /// Etiqueta para el usuario.
  public var label: String {
    switch self {
    case .working: "Trabajando"
    case .waiting: "Esperando"
    case .done: "Terminó"
    case .idle: "Inactiva"
    case .ended: "Cerrada"
    }
  }
}

public enum OriginKind: String, Codable, Sendable {
  case cli, ide, desktop, unknown
}

public struct SessionOrigin: Codable, Sendable, Equatable {
  public var kind: OriginKind
  public var entrypoint: String?
  public var bundleId: String?
  public var termProgram: String?

  public init(kind: OriginKind, entrypoint: String? = nil, bundleId: String? = nil, termProgram: String? = nil) {
    self.kind = kind
    self.entrypoint = entrypoint
    self.bundleId = bundleId
    self.termProgram = termProgram
  }
}

/// Subconjunto de la sesión del core que usa la app; los demás campos se ignoran.
public struct Session: Codable, Sendable, Equatable, Identifiable {
  public var id: String
  public var sessionId: String
  public var pid: Int?
  public var state: SessionState
  public var origin: SessionOrigin
  public var cwd: String?
  public var projectName: String?
  /// Carpeta abierta en el IDE y terminal del proceso: sirven para enfocar la sesión exacta.
  public var projectDir: String?
  public var tty: String?
  public var model: String?
  public var lastPrompt: String?
  /// Milisegundos desde epoch, como en el core.
  public var startedAt: Double
  public var stateChangedAt: Double
  public var lastActivityAt: Double

  public init(
    id: String, sessionId: String, pid: Int? = nil, state: SessionState, origin: SessionOrigin,
    cwd: String? = nil, projectName: String? = nil, projectDir: String? = nil, tty: String? = nil,
    model: String? = nil, lastPrompt: String? = nil,
    startedAt: Double, stateChangedAt: Double, lastActivityAt: Double
  ) {
    self.id = id
    self.sessionId = sessionId
    self.pid = pid
    self.state = state
    self.origin = origin
    self.cwd = cwd
    self.projectName = projectName
    self.projectDir = projectDir
    self.tty = tty
    self.model = model
    self.lastPrompt = lastPrompt
    self.startedAt = startedAt
    self.stateChangedAt = stateChangedAt
    self.lastActivityAt = lastActivityAt
  }

  public var startedDate: Date { Date(timeIntervalSince1970: startedAt / 1000) }
  public var title: String { projectName ?? "Sin proyecto" }
}

/// Eventos de `GET /v1/events` (`liveEventSchema` en el core).
public enum LiveEvent: Sendable, Equatable {
  case snapshot([Session])
  case updated(Session)
  case removed(String)

  private struct SnapshotPayload: Decodable { let sessions: [Session] }
  private struct UpdatedPayload: Decodable { let session: Session }
  private struct RemovedPayload: Decodable { let id: String }

  /// Decodifica un mensaje SSE; devuelve `nil` para `ping` y eventos desconocidos.
  public static func decode(_ message: SSEMessage) throws -> LiveEvent? {
    let data = Data(message.data.utf8)
    let decoder = JSONDecoder()
    switch message.event {
    case "snapshot": return .snapshot(try decoder.decode(SnapshotPayload.self, from: data).sessions)
    case "session.updated": return .updated(try decoder.decode(UpdatedPayload.self, from: data).session)
    case "session.removed": return .removed(try decoder.decode(RemovedPayload.self, from: data).id)
    default: return nil
    }
  }
}

/// Sesiones conocidas, actualizadas con cada evento en vivo.
public struct SessionList: Sendable, Equatable {
  public private(set) var byId: [String: Session] = [:]

  public init() {}

  public mutating func apply(_ event: LiveEvent) {
    switch event {
    case .snapshot(let sessions):
      byId = Dictionary(sessions.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
    case .updated(let session):
      byId[session.id] = session
    case .removed(let id):
      byId[id] = nil
    }
    // Las terminadas no se muestran: su banda desaparece.
    byId = byId.filter { $0.value.state != .ended }
  }

  /// Sesiones abiertas, de la más antigua a la más reciente.
  public var visible: [Session] {
    byId.values.sorted { ($0.startedAt, $0.id) < ($1.startedAt, $1.id) }
  }
}
