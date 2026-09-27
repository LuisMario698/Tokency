import AppKit
import ServiceManagement
import SwiftUI
import TokencyKit

/// Consumo de una sesión para mostrar: el costo oficial de su status line si lo hay (terminal);
/// si no, lo calculado de su JSONL en las últimas 24 h.
func sessionConsumption(_ session: Session, usage: SessionUsage?) -> String? {
  var parts: [String] = []
  if let cost = session.metrics?.costUsd {
    parts.append(UsageFormat.money(cost))
  } else if let usage {
    parts.append("\(UsageFormat.money(usage.cost)) · \(UsageFormat.tokens(usage.totalTokens)) tokens")
  }
  if let context = session.metrics?.contextUsedPercentage {
    parts.append("ctx \(Int(context.rounded())) %")
  }
  return parts.isEmpty ? nil : parts.joined(separator: " · ")
}

// MARK: - Bandas

struct BandsView: View {
  @ObservedObject var model: BandsViewModel
  let onTap: (Session) -> Void

  var body: some View {
    VStack(spacing: model.gap) {
      ForEach(model.sessions) { session in
        BandRow(
          session: session, usage: model.usage[session.sessionId], expanded: model.expanded, edge: model.edge,
          height: model.bandHeight)
          .contentShape(Rectangle())
          .onTapGesture { onTap(session) }
          .help(session.title)
      }
    }
    // Margen para el brillo: arriba, abajo y del lado interior, nunca contra el borde.
    .padding(.vertical, model.glow)
    .padding(model.edge == .right ? .leading : .trailing, model.glow)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

private struct BandRow: View {
  let session: Session
  let usage: SessionUsage?
  let expanded: Bool
  let edge: BandEdge
  let height: CGFloat

  private var shape: UnevenRoundedRectangle {
    let radius: CGFloat = expanded ? 10 : 4
    return UnevenRoundedRectangle(
      topLeadingRadius: edge == .right ? radius : 0, bottomLeadingRadius: edge == .right ? radius : 0,
      bottomTrailingRadius: edge == .left ? radius : 0, topTrailingRadius: edge == .left ? radius : 0)
  }

  var body: some View {
    let color = session.state.neon
    ZStack(alignment: .leading) {
      if expanded {
        shape.fill(Neon.background.opacity(0.94))
        shape.strokeBorder(color, lineWidth: 1.5)
        // Franja brillante del lado del borde de la pantalla.
        HStack(spacing: 0) {
          if edge == .right { Spacer(minLength: 0) }
          Rectangle().fill(color).frame(width: 3)
          if edge == .left { Spacer(minLength: 0) }
        }
        details.padding(.horizontal, 12)
      } else {
        shape.fill(
          LinearGradient(colors: [color.opacity(0.75), color, color.opacity(0.75)], startPoint: .top, endPoint: .bottom))
      }
    }
    .frame(height: height)
    .neonGlow(color, radius: expanded ? 8 : 5)
  }

  private var details: some View {
    TimelineView(.periodic(from: .now, by: 30)) { context in
      VStack(alignment: .leading, spacing: 3) {
        HStack {
          Text(session.title).font(.system(size: 12, weight: .bold, design: .rounded)).foregroundStyle(Neon.text)
            .lineLimit(1)
          Spacer(minLength: 6)
          Text(session.state.label.uppercased())
            .font(.system(size: 9, weight: .heavy, design: .rounded)).kerning(0.6)
            .foregroundStyle(session.state.neon)
        }
        if height >= 36 {
          Text("\(SystemActions.originLabel(session)) · \(elapsedLabel(since: session.startedDate, now: context.date))")
            .font(.system(size: 10)).foregroundStyle(Neon.dim).lineLimit(1)
        }
        if height >= 48, let consumption = sessionConsumption(session, usage: usage) {
          Text(consumption).font(.system(size: 10, weight: .semibold, design: .rounded)).foregroundStyle(Neon.green)
            .lineLimit(1)
        }
        if height >= 62, let prompt = session.lastPrompt {
          Text("«\(prompt)»").font(.system(size: 10)).foregroundStyle(Neon.dim).lineLimit(1)
        }
      }
    }
  }
}

// MARK: - Menú

struct MenuBarLabel: View {
  @ObservedObject var model: AppModel

  var body: some View {
    HStack(spacing: 3) {
      Image(systemName: model.menuBarSymbol)
      // El porcentaje oficial de la sesión de 5 horas, si ya llegó; si no, cuántas sesiones hay.
      if let five = model.usage?.plan?.fiveHour {
        Text("\(Int(five.displayPercentage.rounded()))%")
      } else if !model.sessions.isEmpty {
        Text("\(model.sessions.count)")
      }
    }
  }
}

struct MenuView: View {
  @ObservedObject var model: AppModel

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      header
      UsageMenuSection(model: model)
      sessionsList
      settings
      HStack {
        Button("Ver log del core") { SystemActions.openCoreLog() }
        Spacer()
        Button("Salir") { NSApp.terminate(nil) }
      }
      .buttonStyle(.borderless)
      .font(.caption)
      .foregroundStyle(Neon.dim)
    }
    .padding(14)
    .frame(width: 360)
    .background(Neon.background)
    .foregroundStyle(Neon.text)
    .tint(Neon.magenta)
    .environment(\.colorScheme, .dark)
    .onAppear { model.refreshLoginItem() }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text("◆ TOKENCY")
          .font(.system(size: 15, weight: .black, design: .rounded)).kerning(1.5)
          .foregroundStyle(Neon.magenta)
          .neonGlow(Neon.magenta, radius: 6)
        Spacer()
        switch model.connection {
        case .connected: NeonBadge(text: "en vivo", color: Neon.green)
        case .connecting: NeonBadge(text: "conectando", color: Neon.dim)
        case .unavailable: NeonBadge(text: "sin core", color: Neon.pink)
        }
      }
      if case .unavailable(let message) = model.connection {
        Text(message).font(.caption).foregroundStyle(Neon.dim)
        Button("Reiniciar core") { model.restartCore() }
      }
    }
  }

  @ViewBuilder private var sessionsList: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("SESIONES").font(.system(size: 10, weight: .heavy, design: .rounded)).kerning(1).foregroundStyle(Neon.cyan)
      if model.sessions.isEmpty {
        Text("No hay sesiones de Claude abiertas.").font(.caption).foregroundStyle(Neon.dim)
      } else {
        ForEach(model.sessions) { session in
          Button {
            model.activate(session)
          } label: {
            SessionRow(session: session, usage: model.usage?.sessions[session.sessionId])
          }
          .buttonStyle(.plain)
        }
      }
    }
    .neonCard()
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
    .font(.caption)
    .toggleStyle(.switch)
    .controlSize(.small)
  }
}

private struct SessionRow: View {
  let session: Session
  let usage: SessionUsage?

  var body: some View {
    TimelineView(.periodic(from: .now, by: 30)) { context in
      HStack(alignment: .top, spacing: 9) {
        Circle().fill(session.state.neon).frame(width: 8, height: 8).padding(.top, 5)
          .neonGlow(session.state.neon, radius: 4)
        VStack(alignment: .leading, spacing: 2) {
          HStack {
            Text(session.title).font(.system(size: 12, weight: .semibold)).lineLimit(1)
            Spacer()
            Text(session.state.label.uppercased())
              .font(.system(size: 9, weight: .heavy, design: .rounded)).kerning(0.5)
              .foregroundStyle(session.state.neon)
          }
          Text("\(SystemActions.originLabel(session)) · \(elapsedLabel(since: session.startedDate, now: context.date))")
            .font(.caption2).foregroundStyle(Neon.dim)
          if let consumption = sessionConsumption(session, usage: usage) {
            Text(consumption).font(.system(size: 10, weight: .semibold, design: .rounded)).foregroundStyle(Neon.green)
          }
          if let prompt = session.lastPrompt {
            Text("«\(prompt)»").font(.caption2).foregroundStyle(Neon.dim).lineLimit(1)
          }
        }
      }
      .contentShape(Rectangle())
    }
  }
}
