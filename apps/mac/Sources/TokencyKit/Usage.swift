import Foundation

// Espejo de `packages/shared/src/usage.ts` (D-015, D-016). Los costos son el equivalente en la
// API con la tabla de precios editable, no lo que cobra el plan.

public struct TokenTotals: Codable, Sendable, Equatable {
  public var inputTokens: Int
  public var outputTokens: Int
  public var cacheWriteTokens: Int
  public var cacheReadTokens: Int
  public var totalTokens: Int
  public var cost: Double
  public var unpricedTokens: Int
  public var messages: Int

  public static let zero = TokenTotals(
    inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, totalTokens: 0, cost: 0,
    unpricedTokens: 0, messages: 0)
}

public struct ActiveWindow: Codable, Sendable, Equatable {
  public var start: Double
  public var end: Double
  public var resetsInMs: Double
  public var totals: TokenTotals
  public var costByModel: [String: Double]
  public var burnRatePerHour: Double
  public var projectedCost: Double
  public var fractionOfCap: Double?
  public var anchored: Bool

  public var endDate: Date { Date(timeIntervalSince1970: end / 1000) }
}

public struct LimitInfo: Codable, Sendable, Equatable {
  public var at: Double
  public var resetsAt: Double?
  public var kind: String
  public var source: String
}

public struct Calibration: Codable, Sendable, Equatable {
  public var estimatedCap: Double?
  public var samples: Int
  public var lastLimit: LimitInfo?
}

public struct SessionUsage: Codable, Sendable, Equatable {
  public var totalTokens: Int
  public var cost: Double
}

/// Porcentaje oficial de un límite del plan, de la status line de Claude Code (D-017).
public struct PlanLimit: Codable, Sendable, Equatable {
  public var usedPercentage: Double
  public var resetsAt: Double
  public var observedAt: Double
  /// Proyección a este momento con el consumo posterior al dato oficial.
  public var estimatedNow: Double
  public var estimated: Bool

  public init(usedPercentage: Double, resetsAt: Double, observedAt: Double, estimatedNow: Double, estimated: Bool) {
    self.usedPercentage = usedPercentage
    self.resetsAt = resetsAt
    self.observedAt = observedAt
    self.estimatedNow = estimatedNow
    self.estimated = estimated
  }

  /// Lo que conviene mostrar: la proyección si la hay, el dato oficial si no.
  public var displayPercentage: Double { estimated ? estimatedNow : usedPercentage }
  public var resetsDate: Date { Date(timeIntervalSince1970: resetsAt / 1000) }
}

public struct PlanUsage: Codable, Sendable, Equatable {
  public var fiveHour: PlanLimit?
  public var sevenDay: PlanLimit?
}

public struct UsageSummary: Codable, Sendable, Equatable {
  public var generatedAt: Double
  public var timeZone: String
  /// Uso oficial del plan; `nil` si todavía no llegó ningún dato de la status line.
  public var plan: PlanUsage?
  public var window: ActiveWindow?
  public var today: TokenTotals
  public var last7Days: TokenTotals
  public var calibration: Calibration
  public var sessions: [String: SessionUsage]
  public var unpricedModels: [String]
  public var firstEntryAt: Double?
}

public struct DailyUsage: Codable, Sendable, Equatable, Identifiable {
  public var date: String
  public var totals: TokenTotals
  public var costByModel: [String: Double]
  public var id: String { date }
}

public struct ProjectUsage: Codable, Sendable, Equatable, Identifiable {
  public var project: String
  public var totals: TokenTotals
  public var sessions: Int
  public var lastActivity: Double
  public var id: String { project }
}

public struct WindowSummary: Codable, Sendable, Equatable, Identifiable {
  public var start: Double
  public var end: Double
  public var lastActivity: Double
  public var totals: TokenTotals
  public var anchored: Bool
  public var limitHit: LimitInfo?
  public var id: Double { start }
}

/// Nivel de la barra de cercanía al tope estimado.
public enum CapLevel: Sendable, Equatable {
  case unknown, low, medium, high

  public init(fraction: Double?) {
    guard let fraction else {
      self = .unknown
      return
    }
    self = fraction >= 0.9 ? .high : fraction >= 0.7 ? .medium : .low
  }

  /// Mismos cortes con un porcentaje de 0 a 100 (como la status line de la terminal).
  public init(percentage: Double?) {
    self.init(fraction: percentage.map { $0 / 100 })
  }
}

public enum UsageFormat {
  private static let moneyFormatter: NumberFormatter = {
    let formatter = NumberFormatter()
    formatter.numberStyle = .currency
    formatter.currencyCode = "USD"
    formatter.currencySymbol = "$"
    formatter.locale = Locale(identifier: "es_MX")
    formatter.maximumFractionDigits = 2
    formatter.minimumFractionDigits = 2
    return formatter
  }()

  public static func money(_ value: Double) -> String {
    moneyFormatter.string(from: NSNumber(value: value)) ?? String(format: "$%.2f", value)
  }

  /// 950 → "950", 12300 → "12.3 mil", 3400000 → "3.4 M".
  public static func tokens(_ value: Int) -> String {
    func oneDecimal(_ number: Double) -> String {
      let rounded = (number * 10).rounded() / 10
      return rounded == rounded.rounded() ? String(Int(rounded)) : String(format: "%.1f", rounded)
    }
    if value >= 1_000_000 { return "\(oneDecimal(Double(value) / 1_000_000)) M" }
    if value >= 1_000 { return "\(oneDecimal(Double(value) / 1_000)) mil" }
    return String(value)
  }

  public static func percent(_ fraction: Double) -> String {
    "\(Int((fraction * 100).rounded())) %"
  }

  /// "4 h 31 min", "12 min", "<1 min".
  public static func duration(ms: Double) -> String {
    elapsedLabel(since: Date(timeIntervalSince1970: 0), now: Date(timeIntervalSince1970: ms / 1000))
  }
}

public let officialUsageURL = URL(string: "https://claude.ai/settings/usage")!
