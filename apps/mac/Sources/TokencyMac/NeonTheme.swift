import SwiftUI
import TokencyKit

/// Paleta neón de Tokency. Es la misma de la status line de la terminal (`statusline.ts`).
enum Neon {
  static let background = Color(red: 0.035, green: 0.027, blue: 0.086)
  static let surface = Color(red: 0.075, green: 0.059, blue: 0.157)
  static let magenta = Color(red: 1.0, green: 0.169, blue: 0.839)
  static let cyan = Color(red: 0.0, green: 0.941, blue: 1.0)
  static let blue = Color(red: 0.118, green: 0.565, blue: 1.0)
  static let green = Color(red: 0.224, green: 1.0, blue: 0.078)
  static let amber = Color(red: 1.0, green: 0.690, blue: 0.0)
  static let pink = Color(red: 1.0, green: 0.180, blue: 0.388)
  static let violet = Color(red: 0.698, green: 0.400, blue: 1.0)
  static let text = Color(red: 0.94, green: 0.93, blue: 1.0)
  static let dim = Color(red: 0.56, green: 0.54, blue: 0.72)

  /// Colores para las series de modelos en las gráficas.
  static let series: [Color] = [cyan, magenta, green, amber, violet, pink, blue]

  static let border = LinearGradient(
    colors: [magenta.opacity(0.7), cyan.opacity(0.7)], startPoint: .topLeading, endPoint: .bottomTrailing)
}

extension SessionState {
  /// Estados del spec §4.2 en versión neón: azul, ámbar, verde y gris.
  var neon: Color {
    switch self {
    case .working: Neon.blue
    case .waiting: Neon.amber
    case .done: Neon.green
    case .idle, .ended: Neon.dim
    }
  }
}

extension CapLevel {
  /// Mismos cortes que la terminal: cian, ámbar desde 70 %, rosa desde 90 %.
  var neon: Color {
    switch self {
    case .unknown: Neon.dim
    case .low: Neon.cyan
    case .medium: Neon.amber
    case .high: Neon.pink
    }
  }
}

extension View {
  /// Brillo neón: dos sombras del mismo color, una cerrada y otra difusa.
  func neonGlow(_ color: Color, radius: CGFloat = 6) -> some View {
    shadow(color: color.opacity(0.85), radius: radius / 3).shadow(color: color.opacity(0.55), radius: radius)
  }

  /// Tarjeta oscura con borde degradado magenta → cian.
  func neonCard(padding: CGFloat = 12) -> some View {
    self.padding(padding)
      .background(RoundedRectangle(cornerRadius: 12).fill(Neon.surface))
      .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Neon.border, lineWidth: 1))
  }
}

/// Barra de progreso neón con brillo.
struct NeonBar: View {
  let fraction: Double
  let color: Color
  var height: CGFloat = 8

  var body: some View {
    GeometryReader { geometry in
      ZStack(alignment: .leading) {
        Capsule().fill(Color.white.opacity(0.08))
        Capsule()
          .fill(LinearGradient(colors: [color.opacity(0.7), color], startPoint: .leading, endPoint: .trailing))
          .frame(width: max(geometry.size.width * min(max(fraction, 0), 1), fraction > 0 ? height : 0))
          .neonGlow(color, radius: 5)
      }
    }
    .frame(height: height)
  }
}

/// Etiqueta pequeña en mayúsculas con borde neón ("OFICIAL", "≈ ESTIMADO").
struct NeonBadge: View {
  let text: String
  let color: Color

  var body: some View {
    Text(text.uppercased())
      .font(.system(size: 8.5, weight: .heavy, design: .rounded))
      .kerning(0.8)
      .foregroundStyle(color)
      .padding(.horizontal, 5)
      .padding(.vertical, 2)
      .overlay(Capsule().strokeBorder(color.opacity(0.8), lineWidth: 1))
      .neonGlow(color, radius: 3)
  }
}
