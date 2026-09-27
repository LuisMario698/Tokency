import AppKit
import Charts
import SwiftUI
import TokencyKit

private func resetLabel(_ date: Date) -> String {
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "es_MX")
  formatter.dateFormat = Calendar.current.isDateInToday(date) ? "'hoy' HH:mm" : "EEE d, HH:mm"
  return formatter.string(from: date)
}

private func ago(_ ms: Double, now: Date) -> String {
  UsageFormat.duration(ms: max(0, now.timeIntervalSince1970 * 1000 - ms))
}

/// Aviso fijo: qué es oficial y qué es estimado (spec §4.3, D-017).
struct EstimateNote: View {
  let hasOfficial: Bool

  var body: some View {
    Text(
      hasOfficial
        ? "El porcentaje es el oficial de Claude (status line). Entre un dato y otro se proyecta con el consumo local. Los montos son el equivalente en la API."
        : "Sin dato oficial todavía: abre Claude Code en la terminal para recibirlo. Mientras tanto, todo es una estimación que solo cubre Claude Code en esta Mac."
    )
    .font(.caption2)
    .foregroundStyle(Neon.dim)
    .fixedSize(horizontal: false, vertical: true)
  }
}

/// Un límite oficial del plan: barra neón, porcentaje, reinicio y frescura del dato.
struct PlanLimitRow: View {
  let label: String
  let limit: PlanLimit

  var body: some View {
    TimelineView(.periodic(from: .now, by: 30)) { context in
      let percentage = limit.displayPercentage
      let color = CapLevel(percentage: percentage).neon
      VStack(alignment: .leading, spacing: 5) {
        HStack(alignment: .firstTextBaseline) {
          Text(label).font(.system(size: 11, weight: .bold, design: .rounded)).foregroundStyle(Neon.text)
          NeonBadge(text: limit.estimated ? "≈ estimado" : "oficial", color: limit.estimated ? Neon.amber : Neon.green)
          Spacer()
          Text("\(Int(percentage.rounded())) %")
            .font(.system(size: 20, weight: .black, design: .rounded)).monospacedDigit()
            .foregroundStyle(color).neonGlow(color, radius: 6)
        }
        NeonBar(fraction: percentage / 100, color: color)
        HStack {
          Text("se reinicia \(resetLabel(limit.resetsDate))")
          Spacer()
          Text(
            limit.estimated
              ? "oficial \(Int(limit.usedPercentage.rounded())) % hace \(ago(limit.observedAt, now: context.date))"
              : "dato de hace \(ago(limit.observedAt, now: context.date))")
        }
        .font(.caption2)
        .foregroundStyle(Neon.dim)
      }
    }
  }
}

/// Uso oficial del plan: sesión de 5 horas y semana.
struct PlanCard: View {
  let summary: UsageSummary

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      if let five = summary.plan?.fiveHour {
        PlanLimitRow(label: "Sesión de 5 horas", limit: five)
      }
      if let week = summary.plan?.sevenDay {
        PlanLimitRow(label: "Semana", limit: week)
      }
      if summary.plan == nil {
        VStack(alignment: .leading, spacing: 4) {
          Text("Uso oficial del plan").font(.system(size: 11, weight: .bold, design: .rounded))
          Text("Todavía no llega: lo manda la status line de Tokency al usar Claude Code en la terminal.")
            .font(.caption2).foregroundStyle(Neon.dim)
        }
      }
    }
  }
}

/// Consumo local de la ventana de 5 horas: costo equivalente, ritmo y proyección.
struct WindowCard: View {
  let summary: UsageSummary

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      if let window = summary.window {
        HStack {
          Text("Consumo de la ventana").font(.system(size: 11, weight: .bold, design: .rounded))
          Spacer()
          Text(UsageFormat.money(window.totals.cost))
            .font(.system(size: 14, weight: .heavy, design: .rounded)).foregroundStyle(Neon.green)
            .neonGlow(Neon.green, radius: 4)
        }
        if summary.plan?.fiveHour == nil {
          // Sin dato oficial, la cercanía al límite solo puede estimarse con la calibración.
          let level = CapLevel(fraction: window.fractionOfCap)
          NeonBar(fraction: window.fractionOfCap ?? 0, color: level.neon, height: 6)
          Text(
            window.fractionOfCap.map { "≈ \(UsageFormat.percent($0)) del tope estimado" }
              ?? "Sin calibrar: marca «Llegué al límite» cuando te pase")
            .font(.caption2).foregroundStyle(level.neon)
        }
        Text(
          "\(UsageFormat.tokens(window.totals.totalTokens)) tokens · ritmo \(UsageFormat.money(window.burnRatePerHour))/h · al cierre ~\(UsageFormat.money(window.projectedCost))"
        )
        .font(.caption2).foregroundStyle(Neon.dim)
      } else {
        Text("Sin ventana de 5 horas abierta: empieza con tu próximo mensaje.")
          .font(.caption2).foregroundStyle(Neon.dim)
      }
    }
  }
}

/// Sección de uso del menú de la barra (spec §4.9).
struct UsageMenuSection: View {
  @ObservedObject var model: AppModel
  @Environment(\.openWindow) private var openWindow

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("USO DEL PLAN").font(.system(size: 10, weight: .heavy, design: .rounded)).kerning(1).foregroundStyle(Neon.cyan)
      if let summary = model.usage {
        PlanCard(summary: summary)
        Divider().overlay(Neon.magenta.opacity(0.3))
        WindowCard(summary: summary)
        HStack {
          Text("Hoy \(UsageFormat.money(summary.today.cost))")
          Spacer()
          Text("7 días \(UsageFormat.money(summary.last7Days.cost))")
        }
        .font(.system(size: 10, weight: .semibold, design: .rounded))
        .foregroundStyle(Neon.violet)
        if !summary.unpricedModels.isEmpty {
          Text("Sin precio: \(summary.unpricedModels.joined(separator: ", "))").font(.caption2).foregroundStyle(Neon.amber)
        }
      } else {
        Text("Leyendo el historial de uso…").font(.caption).foregroundStyle(Neon.dim)
      }
      HStack {
        Button("Llegué al límite") { model.markLimitHit() }
          .help("Anota el consumo de esta ventana para estimar mejor el tope de tu plan.")
        Spacer()
        Button("Historial…") {
          openWindow(id: UsageHistoryView.windowID)
          NSApp.activate()
        }
      }
      .controlSize(.small)
      if let message = model.usageMessage {
        Text(message).font(.caption2).foregroundStyle(Neon.dim)
      }
      EstimateNote(hasOfficial: model.usage?.plan != nil)
    }
    .neonCard()
  }
}

// MARK: - Ventana de historial

struct UsageHistoryView: View {
  static let windowID = "usage-history"

  @ObservedObject var model: AppModel
  @ObservedObject var history: UsageHistoryModel

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        title
        HStack(alignment: .top, spacing: 16) {
          if let summary = model.usage {
            VStack(alignment: .leading, spacing: 12) {
              PlanCard(summary: summary)
              Divider().overlay(Neon.magenta.opacity(0.3))
              WindowCard(summary: summary)
            }
            .frame(maxWidth: 380)
            .neonCard(padding: 16)
          }
          controls
        }
        if let error = history.error {
          Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(Neon.amber)
        }
        chart.neonCard(padding: 16)
        projectsTable.neonCard(padding: 16)
        windowsList.neonCard(padding: 16)
        footer
      }
      .padding(22)
    }
    .frame(minWidth: 720, minHeight: 620)
    .background(Neon.background)
    .foregroundStyle(Neon.text)
    .tint(Neon.magenta)
    .environment(\.colorScheme, .dark)
    .onAppear { history.reload(using: model) }
    .onChange(of: history.days) { _, _ in history.reload(using: model) }
    .onChange(of: model.usage?.generatedAt) { _, _ in history.reload(using: model) }
  }

  private var title: some View {
    HStack(alignment: .firstTextBaseline) {
      Text("◆ HISTORIAL DE USO")
        .font(.system(size: 22, weight: .black, design: .rounded)).kerning(2)
        .foregroundStyle(Neon.magenta).neonGlow(Neon.magenta, radius: 8)
      Spacer()
      Link("Uso oficial de tu cuenta ↗", destination: officialUsageURL).font(.caption).foregroundStyle(Neon.cyan)
    }
  }

  private var controls: some View {
    VStack(alignment: .leading, spacing: 10) {
      Picker("Periodo", selection: $history.days) {
        Text("7 días").tag(7)
        Text("14 días").tag(14)
        Text("30 días").tag(30)
        Text("90 días").tag(90)
      }
      .pickerStyle(.segmented)
      Picker("Métrica", selection: $history.metric) {
        ForEach(UsageHistoryModel.Metric.allCases) { Text($0.rawValue).tag($0) }
      }
      .pickerStyle(.segmented)
      if let summary = model.usage {
        calibrationText(summary)
      }
      Button("Llegué al límite") { model.markLimitHit() }
      EstimateNote(hasOfficial: model.usage?.plan != nil)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func calibrationText(_ summary: UsageSummary) -> some View {
    let calibration = summary.calibration
    let text: String
    if let cap = calibration.estimatedCap {
      text = "Una sesión de 5 horas aguanta ~\(UsageFormat.money(cap)) equivalentes (\(calibration.samples) muestras)."
    } else {
      text = "Sin calibrar todavía."
    }
    return Text(text).font(.caption).foregroundStyle(Neon.violet)
  }

  private struct Point: Identifiable {
    let id: String
    let date: String
    let model: String
    let value: Double
  }

  private var points: [Point] {
    history.daily.flatMap { day -> [Point] in
      switch history.metric {
      case .cost:
        return day.costByModel.map {
          Point(id: "\(day.date)-\($0.key)", date: shortDate(day.date), model: $0.key, value: $0.value)
        }
      case .tokens:
        return [Point(id: day.date, date: shortDate(day.date), model: "Tokens", value: Double(day.totals.totalTokens))]
      }
    }
  }

  private var chart: some View {
    let models = Array(Set(points.map(\.model))).sorted()
    return VStack(alignment: .leading, spacing: 10) {
      Text(history.metric == .cost ? "COSTO EQUIVALENTE POR DÍA Y MODELO" : "TOKENS POR DÍA")
        .font(.system(size: 11, weight: .heavy, design: .rounded)).kerning(1).foregroundStyle(Neon.cyan)
      Chart(points) { point in
        BarMark(x: .value("Día", point.date), y: .value(history.metric.rawValue, point.value))
          .foregroundStyle(by: .value("Modelo", point.model))
          .cornerRadius(3)
      }
      .chartForegroundStyleScale(domain: models, range: Array(Neon.series.prefix(max(models.count, 1))))
      .chartYAxis {
        AxisMarks { value in
          AxisGridLine().foregroundStyle(Neon.dim.opacity(0.25))
          AxisValueLabel {
            if let number = value.as(Double.self) {
              Text(history.metric == .cost ? UsageFormat.money(number) : UsageFormat.tokens(Int(number)))
                .foregroundStyle(Neon.dim)
            }
          }
        }
      }
      .chartXAxis {
        AxisMarks { _ in
          AxisValueLabel().foregroundStyle(Neon.dim)
        }
      }
      .frame(height: 230)
      if history.daily.allSatisfy({ $0.totals.messages == 0 }) {
        Text("Sin uso en este periodo.").font(.caption).foregroundStyle(Neon.dim)
      }
    }
  }

  private var projectsTable: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("POR PROYECTO").font(.system(size: 11, weight: .heavy, design: .rounded)).kerning(1).foregroundStyle(Neon.cyan)
      let maxCost = history.projects.map(\.totals.cost).max() ?? 1
      ForEach(history.projects.prefix(12)) { project in
        HStack(spacing: 10) {
          Text(project.project).font(.system(size: 12, weight: .semibold)).lineLimit(1).frame(width: 170, alignment: .leading)
          NeonBar(fraction: maxCost > 0 ? project.totals.cost / maxCost : 0, color: Neon.magenta, height: 6)
          Text(UsageFormat.money(project.totals.cost)).monospacedDigit().foregroundStyle(Neon.green)
            .frame(width: 84, alignment: .trailing)
          Text("\(project.sessions) \(project.sessions == 1 ? "sesión" : "sesiones")")
            .font(.caption).foregroundStyle(Neon.dim).frame(width: 74, alignment: .trailing)
        }
      }
      if history.projects.isEmpty {
        Text("Sin proyectos en este periodo.").font(.caption).foregroundStyle(Neon.dim)
      }
    }
  }

  private var windowsList: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("SESIONES DE 5 HORAS").font(.system(size: 11, weight: .heavy, design: .rounded)).kerning(1)
        .foregroundStyle(Neon.cyan)
      ForEach(history.windows.prefix(20)) { window in
        HStack {
          Text(range(window)).monospacedDigit()
          if window.anchored { NeonBadge(text: "reinicio exacto", color: Neon.cyan) }
          if window.limitHit != nil { NeonBadge(text: "límite", color: Neon.pink) }
          Spacer()
          Text(UsageFormat.tokens(window.totals.totalTokens)).foregroundStyle(Neon.dim).monospacedDigit()
          Text(UsageFormat.money(window.totals.cost)).monospacedDigit().foregroundStyle(Neon.green)
            .frame(width: 90, alignment: .trailing)
        }
        .font(.callout)
      }
      if history.windows.isEmpty {
        Text("Sin ventanas en este periodo.").font(.caption).foregroundStyle(Neon.dim)
      }
    }
  }

  private var footer: some View {
    HStack {
      Text("Los precios son editables en config.json (`pricing`).").font(.caption).foregroundStyle(Neon.dim)
      Button("Abrir configuración") {
        NSWorkspace.shared.open(
          CoreSettings.supportDirectory(home: FileManager.default.homeDirectoryForCurrentUser).appending(
            path: "config.json"))
      }
      .font(.caption)
    }
  }

  private func shortDate(_ date: String) -> String {
    let parts = date.split(separator: "-")
    return parts.count == 3 ? "\(parts[2])/\(parts[1])" : date
  }

  private func range(_ window: WindowSummary) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "es_MX")
    formatter.dateFormat = "EEE d MMM HH:mm"
    let endFormatter = DateFormatter()
    endFormatter.dateFormat = "HH:mm"
    let start = Date(timeIntervalSince1970: window.start / 1000)
    let end = Date(timeIntervalSince1970: window.end / 1000)
    return "\(formatter.string(from: start)) → \(endFormatter.string(from: end))"
  }
}

/// Estado de la ventana de historial. Es un `ObservableObject` y no `@State` porque sin Xcode
/// no hay plugin de macros de SwiftUI (D-012).
@MainActor
final class UsageHistoryModel: ObservableObject {
  enum Metric: String, CaseIterable, Identifiable {
    case cost = "Costo equivalente"
    case tokens = "Tokens"
    var id: String { rawValue }
  }

  @Published var days = 14
  @Published var metric: Metric = .cost
  @Published private(set) var daily: [DailyUsage] = []
  @Published private(set) var projects: [ProjectUsage] = []
  @Published private(set) var windows: [WindowSummary] = []
  @Published private(set) var error: String?
  private var loading: Task<Void, Never>?

  func reload(using model: AppModel) {
    loading?.cancel()
    let days = days
    loading = Task { [weak self] in
      guard let api = await model.api() else {
        self?.error = CoreSettingsError.missingToken.errorDescription
        return
      }
      do {
        async let dailyData = api.daily(days: days)
        async let projectData = api.projects(days: days)
        async let windowData = api.windows(days: min(days, 30))
        let (daily, projects, windows) = try await (dailyData, projectData, windowData)
        guard !Task.isCancelled else { return }
        self?.daily = daily
        self?.projects = projects
        self?.windows = windows
        self?.error = nil
      } catch {
        guard !Task.isCancelled else { return }
        self?.error =
          "No se pudo leer el historial: \((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)"
      }
    }
  }
}
