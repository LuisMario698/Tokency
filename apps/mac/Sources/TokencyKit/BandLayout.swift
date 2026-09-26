import CoreGraphics

public enum BandEdge: String, Sendable, CaseIterable {
  case right, left

  public var label: String { self == .right ? "Derecho" : "Izquierdo" }
}

public struct BandMetrics: Sendable, Equatable {
  /// Ancho de la banda sin el mouse encima.
  public var collapsedWidth: CGFloat = 7
  /// Ancho al pasar el mouse, con los detalles de cada sesión.
  public var expandedWidth: CGFloat = 320
  public var bandHeight: CGFloat = 64
  public var minBandHeight: CGFloat = 20
  public var gap: CGFloat = 4
  /// Fracción máxima de la altura de la pantalla que ocupan las bandas.
  public var maxHeightFraction: CGFloat = 0.7

  public init() {}
}

/// Geometría del panel de bandas: centrado en vertical y pegado al borde elegido.
public enum BandLayout {
  /// Alto de cada banda: el normal, o menos si no caben todas.
  public static func bandHeight(count: Int, available: CGFloat, metrics: BandMetrics) -> CGFloat {
    guard count > 0 else { return 0 }
    let limit = available * metrics.maxHeightFraction
    let natural = CGFloat(count) * metrics.bandHeight + CGFloat(count - 1) * metrics.gap
    guard natural > limit else { return metrics.bandHeight }
    let fitted = (limit - CGFloat(count - 1) * metrics.gap) / CGFloat(count)
    return max(metrics.minBandHeight, fitted.rounded(.down))
  }

  public static func panelFrame(
    visibleFrame: CGRect, edge: BandEdge, count: Int, expanded: Bool, metrics: BandMetrics
  ) -> CGRect {
    guard count > 0 else { return .zero }
    let height = bandHeight(count: count, available: visibleFrame.height, metrics: metrics)
    let total = CGFloat(count) * height + CGFloat(count - 1) * metrics.gap
    let width = expanded ? metrics.expandedWidth : metrics.collapsedWidth
    let x = edge == .right ? visibleFrame.maxX - width : visibleFrame.minX
    let y = (visibleFrame.midY - total / 2).rounded(.down)
    return CGRect(x: x, y: y, width: width, height: total)
  }
}
