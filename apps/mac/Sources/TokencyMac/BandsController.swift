import AppKit
import SwiftUI
import TokencyKit

/// Datos que muestra la vista de bandas.
@MainActor
final class BandsViewModel: ObservableObject {
  @Published var sessions: [Session] = []
  @Published var expanded = false
  @Published var edge: BandEdge = .right
  @Published var bandHeight: CGFloat = BandMetrics().bandHeight
  let gap = BandMetrics().gap
}

/// Vista raíz del panel: avisa cuando el mouse entra o sale, aunque la app no esté activa.
private final class TrackingView: NSView {
  var onHoverChange: ((Bool) -> Void)?

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    trackingAreas.forEach(removeTrackingArea)
    addTrackingArea(
      NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
  }

  override func mouseEntered(with event: NSEvent) { onHoverChange?(true) }
  override func mouseExited(with event: NSEvent) { onHoverChange?(false) }
}

/// Acepta el primer clic sin que la app tenga que activarse antes.
private final class FirstMouseHostingView<Content: View>: NSHostingView<Content> {
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

/// Panel de bandas en el borde de la pantalla principal (spec §4.9).
@MainActor
final class BandsController {
  var onActivate: ((Session) -> Void)?

  private let panel: NSPanel
  private let model = BandsViewModel()
  private let metrics = BandMetrics()
  private var visible = true
  private var screenObserver: NSObjectProtocol?

  init() {
    panel = NSPanel(
      contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.isFloatingPanel = true
    panel.level = .statusBar
    // Visible en todos los Spaces y junto a apps en pantalla completa, sin entrar en ⌘Tab.
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    panel.hidesOnDeactivate = false
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = false
    panel.isMovable = false
    panel.becomesKeyOnlyIfNeeded = true

    let root = TrackingView()
    let hosting = FirstMouseHostingView(
      rootView: BandsView(model: model, onTap: { [weak self] session in self?.onActivate?(session) }))
    hosting.translatesAutoresizingMaskIntoConstraints = false
    root.addSubview(hosting)
    NSLayoutConstraint.activate([
      hosting.leadingAnchor.constraint(equalTo: root.leadingAnchor),
      hosting.trailingAnchor.constraint(equalTo: root.trailingAnchor),
      hosting.topAnchor.constraint(equalTo: root.topAnchor),
      hosting.bottomAnchor.constraint(equalTo: root.bottomAnchor),
    ])
    panel.contentView = root
    root.onHoverChange = { [weak self] inside in self?.setExpanded(inside) }

    // Cambios de resolución, monitores conectados o desconectados.
    screenObserver = NotificationCenter.default.addObserver(
      forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated { self?.relayout() }
    }
  }

  func update(sessions: [Session], visible: Bool, edge: BandEdge) {
    self.visible = visible
    model.sessions = sessions
    model.edge = edge
    relayout()
  }

  private func setExpanded(_ expanded: Bool) {
    guard model.expanded != expanded else { return }
    model.expanded = expanded
    relayout()
  }

  private func relayout() {
    // La pantalla con la barra de menús; si se desconecta un monitor, la que quede.
    guard visible, !model.sessions.isEmpty, let screen = NSScreen.screens.first else {
      model.expanded = false
      panel.orderOut(nil)
      return
    }
    let count = model.sessions.count
    model.bandHeight = BandLayout.bandHeight(count: count, available: screen.visibleFrame.height, metrics: metrics)
    let frame = BandLayout.panelFrame(
      visibleFrame: screen.visibleFrame, edge: model.edge, count: count, expanded: model.expanded, metrics: metrics)
    panel.setFrame(frame, display: true)
    panel.orderFrontRegardless()
    if ProcessInfo.processInfo.environment["TOKENCY_DEBUG"] == "1" {
      // stderr no usa búfer: las líneas aparecen aunque la salida vaya a un archivo.
      let line = "bandas: \(count) en \(frame), visible=\(panel.isVisible), pantalla \(screen.frame)\n"
      FileHandle.standardError.write(Data(line.utf8))
    }
  }
}
