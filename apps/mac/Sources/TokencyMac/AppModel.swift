import AppKit
import ServiceManagement
import TokencyKit

/// Estado de la app: conexión con el core, sesiones y preferencias.
@MainActor
final class AppModel: ObservableObject {
  enum Connection: Equatable {
    case connecting
    case connected
    case unavailable(String)
  }

  @Published private(set) var sessions: [Session] = []
  @Published private(set) var connection: Connection = .connecting
  @Published private(set) var loginItemEnabled = LoginItem.isEnabled
  @Published private(set) var loginItemNeedsApproval = LoginItem.needsApproval
  @Published var bandsVisible: Bool {
    didSet {
      defaults.set(bandsVisible, forKey: "bandsVisible")
      refreshBands()
    }
  }
  @Published var bandEdge: BandEdge {
    didSet {
      defaults.set(bandEdge.rawValue, forKey: "bandEdge")
      refreshBands()
    }
  }

  let bands = BandsController()
  private let defaults = UserDefaults.standard
  private var list = SessionList()
  private var loop: Task<Void, Never>?

  init() {
    bandsVisible = defaults.object(forKey: "bandsVisible") as? Bool ?? true
    bandEdge = BandEdge(rawValue: defaults.string(forKey: "bandEdge") ?? "") ?? .right
  }

  func start() {
    bands.onActivate = { session in SystemActions.focus(session) }
    LoginItem.registerOnFirstLaunch()
    refreshLoginItem()
    loop = Task { [weak self] in await self?.run() }
  }

  /// Se conecta al core y se reconecta con espera creciente si se cae (spec §4.9).
  private func run() async {
    var delay: Duration = .seconds(1)
    while !Task.isCancelled {
      do {
        let endpoint = try await Task.detached { try CoreSettings.endpoint() }.value
        for try await event in CoreEventStream.events(endpoint: endpoint) {
          if case .snapshot = event {
            connection = .connected
            delay = .seconds(1)
          }
          list.apply(event)
          publish()
        }
      } catch is CancellationError {
        return
      } catch {
        connection = .unavailable(Self.describe(error))
      }
      if case .connected = connection { connection = .unavailable(CoreStreamError.closed.localizedDescription) }
      // Sin core no hay estado confiable: las bandas se ocultan hasta reconectar.
      list.apply(.snapshot([]))
      publish()
      try? await Task.sleep(for: delay)
      delay = min(delay * 2, .seconds(10))
    }
  }

  private static func describe(_ error: Error) -> String {
    if let urlError = error as? URLError,
      [.cannotConnectToHost, .networkConnectionLost, .timedOut].contains(urlError.code)
    {
      return "El core no está corriendo."
    }
    return (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
  }

  private func publish() {
    sessions = list.visible
    refreshBands()
  }

  private func refreshBands() {
    bands.update(sessions: sessions, visible: bandsVisible, edge: bandEdge)
  }

  func activate(_ session: Session) {
    SystemActions.focus(session)
  }

  func restartCore() {
    SystemActions.restartCore()
    connection = .connecting
  }

  func setLoginItem(_ enabled: Bool) {
    try? LoginItem.setEnabled(enabled)
    refreshLoginItem()
  }

  func refreshLoginItem() {
    loginItemEnabled = LoginItem.isEnabled
    loginItemNeedsApproval = LoginItem.needsApproval
  }

  /// Ícono de la barra de menús según la sesión más urgente.
  var menuBarSymbol: String {
    let states = Set(sessions.map(\.state))
    if case .unavailable = connection { return "exclamationmark.triangle" }
    if states.contains(.waiting) { return "exclamationmark.circle.fill" }
    if states.contains(.working) { return "circle.dotted.circle" }
    if states.contains(.done) { return "checkmark.circle" }
    return "circle"
  }
}
