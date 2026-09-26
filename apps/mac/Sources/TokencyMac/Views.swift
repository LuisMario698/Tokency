import AppKit
import ServiceManagement
import SwiftUI
import TokencyKit

extension SessionState {
  /// Colores del spec §4.2: azul, ámbar, verde y gris.
  var color: Color {
    switch self {
    case .working: Color(red: 0.20, green: 0.48, blue: 0.96)
    case .waiting: Color(red: 0.98, green: 0.62, blue: 0.10)
    case .done: Color(red: 0.20, green: 0.72, blue: 0.36)
    case .idle, .ended: Color(white: 0.55)
    }
  }
}

// MARK: - Bandas

struct BandsView: View {
  @ObservedObject var model: BandsViewModel
  let onTap: (Session) -> Void

  var body: some View {
    VStack(spacing: model.gap) {
      ForEach(model.sessions) { session in
        BandRow(session: session, expanded: model.expanded, edge: model.edge, height: model.bandHeight)
          .contentShape(Rectangle())
          .onTapGesture { onTap(session) }
          .help(session.title)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

private struct BandRow: View {
  let session: Session
  let expanded: Bool
  let edge: BandEdge
  let height: CGFloat

  var body: some View {
    ZStack(alignment: .leading) {
      UnevenRoundedRectangle(
        topLeadingRadius: edge == .right ? 6 : 0, bottomLeadingRadius: edge == .right ? 6 : 0,
        bottomTrailingRadius: edge == .left ? 6 : 0, topTrailingRadius: edge == .left ? 6 : 0
      )
      .fill(session.state.color.opacity(expanded ? 0.96 : 0.9))
      if expanded {
        details.padding(.horizontal, 10)
      }
    }
    .frame(height: height)
  }

  private var details: some View {
    TimelineView(.periodic(from: .now, by: 30)) { context in
      VStack(alignment: .leading, spacing: 2) {
        HStack {
          Text(session.title).font(.system(size: 12, weight: .semibold)).lineLimit(1)
          Spacer(minLength: 6)
          Text(session.state.label).font(.system(size: 10, weight: .medium)).opacity(0.85)
        }
        if height >= 36 {
          Text("\(SystemActions.originLabel(session)) · \(elapsedLabel(since: session.startedDate, now: context.date))")
            .font(.system(size: 10)).opacity(0.85).lineLimit(1)
        }
        if height >= 52, let prompt = session.lastPrompt {
          Text("«\(prompt)»").font(.system(size: 10)).opacity(0.85).lineLimit(1)
        }
      }
      .foregroundStyle(.white)
    }
  }
}

// MARK: - Menú

struct MenuBarLabel: View {
  @ObservedObject var model: AppModel

  var body: some View {
    let count = model.sessions.count
    HStack(spacing: 3) {
      Image(systemName: model.menuBarSymbol)
      if count > 0 { Text("\(count)") }
    }
  }
}

struct MenuView: View {
  @ObservedObject var model: AppModel

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      header
      Divider()
      sessionsList
      Divider()
      settings
      Divider()
      HStack {
        Button("Ver log del core") { SystemActions.openCoreLog() }
        Spacer()
        Button("Salir") { NSApp.terminate(nil) }
      }
    }
    .padding(14)
    .frame(width: 340)
    .onAppear { model.refreshLoginItem() }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text("Tokency").font(.headline)
        Spacer()
        switch model.connection {
        case .connected: Label("Conectado", systemImage: "circle.fill").foregroundStyle(.green)
        case .connecting: Label("Conectando…", systemImage: "circle.dotted").foregroundStyle(.secondary)
        case .unavailable: Label("Sin core", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
        }
      }
      .font(.caption)
      if case .unavailable(let message) = model.connection {
        Text(message).font(.caption).foregroundStyle(.secondary)
        Button("Reiniciar core") { model.restartCore() }
      }
    }
  }

  @ViewBuilder private var sessionsList: some View {
    if model.sessions.isEmpty {
      Text("No hay sesiones de Claude abiertas.").foregroundStyle(.secondary)
    } else {
      VStack(alignment: .leading, spacing: 6) {
        ForEach(model.sessions) { session in
          Button {
            model.activate(session)
          } label: {
            SessionRow(session: session)
          }
          .buttonStyle(.plain)
        }
      }
    }
  }

  private var settings: some View {
    VStack(alignment: .leading, spacing: 8) {
      Toggle("Mostrar bandas", isOn: $model.bandsVisible)
      Picker("Borde", selection: $model.bandEdge) {
        ForEach(BandEdge.allCases, id: \.self) { Text($0.label).tag($0) }
      }
      .pickerStyle(.segmented)
      Toggle("Abrir al iniciar sesión", isOn: Binding(get: { model.loginItemEnabled }, set: { model.setLoginItem($0) }))
      if model.loginItemNeedsApproval {
        Button("Aprobar en Ajustes del Sistema…") { SMAppService.openSystemSettingsLoginItems() }
          .font(.caption)
      }
    }
  }
}

private struct SessionRow: View {
  let session: Session

  var body: some View {
    TimelineView(.periodic(from: .now, by: 30)) { context in
      HStack(alignment: .top, spacing: 8) {
        Circle().fill(session.state.color).frame(width: 9, height: 9).padding(.top, 4)
        VStack(alignment: .leading, spacing: 1) {
          HStack {
            Text(session.title).fontWeight(.medium).lineLimit(1)
            Spacer()
            Text(session.state.label).font(.caption).foregroundStyle(.secondary)
          }
          Text("\(SystemActions.originLabel(session)) · \(elapsedLabel(since: session.startedDate, now: context.date))")
            .font(.caption).foregroundStyle(.secondary)
          if let prompt = session.lastPrompt {
            Text("«\(prompt)»").font(.caption).foregroundStyle(.secondary).lineLimit(1)
          }
        }
      }
      .contentShape(Rectangle())
    }
  }
}
