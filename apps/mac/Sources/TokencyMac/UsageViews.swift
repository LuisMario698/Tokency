import AppKit
import Charts
import SwiftUI
import TokencyKit

extension CapLevel {
  var color: Color {
    switch self {
    case .unknown: .secondary
    case .low: .green
    case .medium: .orange
    case .high: .red
    }
  }
}

/// Aviso fijo del spec §4.3: siempre se muestra que es una estimación parcial.
struct EstimateNote: View {
  var body: some View {
    Text("Estimación: solo Claude Code en esta Mac. El chat de claude.ai comparte el límite pero no se ve aquí.")
      .font(.caption2)
      .foregroundStyle(.secondary)
      .fixedSize(horizontal: false, vertical: true)
  }
}

/// Barra de cercanía al tope estimado de la ventana de 5 horas.
struct CapBar: View {
  let fraction: Double?

  var body: some View {
    let level = CapLevel(fraction: fraction)
    GeometryReader { geometry in
      ZStack(alignment: .leading) {
        Capsule().fill(Color.secondary.opacity(0.2))
        Capsule()
          .fill(level.color)
          .frame(width: geometry.size.width * min(max(fraction ?? 0, 0), 1))
      }
    }
    .frame(height: 6)
    .accessibilityLabel(fraction.map { "\(UsageFormat.percent($0)) del tope estimado" } ?? "Sin calibrar")
  }
}

/// Resumen de la ventana vigente; se usa en el menú y en la ventana de historial.
struct WindowCard: View {
  let summary: UsageSummary

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      if let window = summary.window {
        HStack {
          Text("Ventana de 5 horas").font(.caption.weight(.semibold))
          Spacer()
          Text("se reinicia en \(UsageFormat.duration(ms: window.resetsInMs))").font(.caption).foregroundStyle(.secondary)
        }
        CapBar(fraction: window.fractionOfCap)
        HStack {
          Text("\(UsageFormat.money(window.totals.cost)) equivalentes")
          Spacer()
          if let fraction = window.fractionOfCap, let cap = summary.calibration.estimatedCap {
            Text("\(UsageFormat.percent(fraction)) de ~\(UsageFormat.money(cap))")
              .foregroundStyle(CapLevel(fraction: fraction).color)
          } else {
            Text("sin calibrar").foregroundStyle(.secondary)
          }
        }
        .font(.caption)
        Text("Ritmo \(UsageFormat.money(window.burnRatePerHour))/h · al cierre ~\(UsageFormat.money(window.projectedCost))")
          .font(.caption2).foregroundStyle(.secondary)
      } else {
        Text("Ventana de 5 horas: ninguna abierta").font(.caption.weight(.semibold))
        Text("Empieza con tu próximo mensaje.").font(.caption).foregroundStyle(.secondary)
      }
    }
  }
}

/// Sección de uso del menú de la barra (spec §4.9).
struct UsageMenuSection: View {
  @ObservedObject var model: AppModel
  @Environment(\.openWindow) private var openWindow

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if let summary = model.usage {
        WindowCard(summary: summary)
        HStack {
          Text("Hoy \(UsageFormat.money(summary.today.cost))")
          Spacer()
          Text("7 días \(UsageFormat.money(summary.last7Days.cost))")
        }
        .font(.caption)
        if !summary.unpricedModels.isEmpty {
          Text("Sin precio: \(summary.unpricedModels.joined(separator: ", "))").font(.caption2).foregroundStyle(.orange)
        }
      } else {
        Text("Leyendo el historial de uso…").font(.caption).foregroundStyle(.secondary)
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
      if let message = model.usageMessage {
        Text(message).font(.caption2).foregroundStyle(.secondary)
      }
      EstimateNote()
    }
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
        header
        if let error = history.error {
          Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
        }
        chart
        projectsTable
        windowsList
        footer
      }
      .padding(20)
    }
    .frame(minWidth: 640, minHeight: 560)
    .onAppear { history.reload(using: model) }
    .onChange(of: history.days) { _, _ in history.reload(using: model) }
    .onChange(of: model.usage?.generatedAt) { _, _ in history.reload(using: model) }
  }

  private var header: some View {
    HStack(alignment: .top, spacing: 20) {
      VStack(alignment: .leading, spacing: 8) {
        if let summary = model.usage {
          WindowCard(summary: summary).frame(maxWidth: 360)
          calibrationText(summary)
        }
        EstimateNote().frame(maxWidth: 360, alignment: .leading)
      }
      Spacer()
      VStack(alignment: .trailing, spacing: 8) {
        Picker("Periodo", selection: $history.days) {
          Text("7 días").tag(7)
          Text("14 días").tag(14)
          Text("30 días").tag(30)
          Text("90 días").tag(90)
        }
        .pickerStyle(.segmented)
        .frame(width: 280)
        Picker("Métrica", selection: $history.metric) {
          ForEach(UsageHistoryModel.Metric.allCases) { Text($0.rawValue).tag($0) }
        }
        .pickerStyle(.segmented)
        .frame(width: 280)
        Button("Llegué al límite") { model.markLimitHit() }
        Link("Ver el uso oficial de tu cuenta", destination: officialUsageURL).font(.caption)
      }
    }
  }

  private func calibrationText(_ summary: UsageSummary) -> some View {
    let calibration = summary.calibration
    let text: String
    if let cap = calibration.estimatedCap {
      text =
        "Tope estimado: ~\(UsageFormat.money(cap)) por ventana, a partir de \(calibration.samples) "
        + (calibration.samples == 1 ? "límite alcanzado." : "límites alcanzados.")
    } else {
      text = "Sin calibrar todavía: cuando llegues al límite, Tokency lo detecta solo o puedes marcarlo con el botón."
    }
    return Text(text).font(.caption).foregroundStyle(.secondary).frame(maxWidth: 360, alignment: .leading)
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
        return day.costByModel.map { Point(id: "\(day.date)-\($0.key)", date: shortDate(day.date), model: $0.key, value: $0.value) }
      case .tokens:
        return [Point(id: day.date, date: shortDate(day.date), model: "Tokens", value: Double(day.totals.totalTokens))]
      }
    }
  }

  private var chart: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(history.metric == .cost ? "Costo equivalente por día y modelo" : "Tokens por día").font(.headline)
      Chart(points) { point in
        BarMark(x: .value("Día", point.date), y: .value(history.metric.rawValue, point.value))
          .foregroundStyle(by: .value("Modelo", point.model))
      }
      .chartYAxis {
        AxisMarks { value in
          AxisGridLine()
          AxisValueLabel {
            if let number = value.as(Double.self) {
              Text(history.metric == .cost ? UsageFormat.money(number) : UsageFormat.tokens(Int(number)))
            }
          }
        }
      }
      .frame(height: 220)
      if history.daily.allSatisfy({ $0.totals.messages == 0 }) {
        Text("Sin uso en este periodo.").font(.caption).foregroundStyle(.secondary)
      }
    }
  }

  private var projectsTable: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("Por proyecto").font(.headline)
      Table(history.projects) {
        TableColumn("Proyecto", value: \.project)
        TableColumn("Costo") { Text(UsageFormat.money($0.totals.cost)).monospacedDigit() }
        TableColumn("Tokens") { Text(UsageFormat.tokens($0.totals.totalTokens)).monospacedDigit() }
        TableColumn("Sesiones") { Text("\($0.sessions)").monospacedDigit() }
        TableColumn("Última actividad") { Text(relative($0.lastActivity)) }
      }
      .frame(height: min(CGFloat(history.projects.count) * 26 + 32, 260))
    }
  }

  private var windowsList: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("Ventanas de 5 horas").font(.headline)
      ForEach(history.windows.prefix(20)) { window in
        HStack {
          Text(range(window)).monospacedDigit()
          if window.limitHit != nil {
            Label("límite", systemImage: "exclamationmark.octagon.fill").foregroundStyle(.red).font(.caption)
          }
          Spacer()
          Text(UsageFormat.tokens(window.totals.totalTokens)).foregroundStyle(.secondary).monospacedDigit()
          Text(UsageFormat.money(window.totals.cost)).monospacedDigit().frame(width: 90, alignment: .trailing)
        }
        .font(.callout)
      }
      if history.windows.isEmpty {
        Text("Sin ventanas en este periodo.").font(.caption).foregroundStyle(.secondary)
      }
    }
  }

  private var footer: some View {
    HStack {
      Text("Los precios son editables en config.json (`pricing`).").font(.caption).foregroundStyle(.secondary)
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
    formatter.dateFormat = "d MMM HH:mm"
    let start = Date(timeIntervalSince1970: window.start / 1000)
    let end = Date(timeIntervalSince1970: window.end / 1000)
    let endFormatter = DateFormatter()
    endFormatter.dateFormat = "HH:mm"
    return "\(formatter.string(from: start)) → \(endFormatter.string(from: end))"
  }

  private func relative(_ ms: Double) -> String {
    let formatter = RelativeDateTimeFormatter()
    formatter.locale = Locale(identifier: "es_MX")
    return formatter.localizedString(for: Date(timeIntervalSince1970: ms / 1000), relativeTo: Date())
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
