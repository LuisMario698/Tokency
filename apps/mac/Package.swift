// swift-tools-version: 6.0
// App de barra de menús de Tokency (D-012). Se compila con `swift build`, sin Xcode.
import PackageDescription

let package = Package(
  name: "TokencyMac",
  platforms: [.macOS(.v14)],
  products: [
    .executable(name: "Tokency", targets: ["TokencyMac"])
  ],
  targets: [
    // Lógica pura, sin AppKit: modelos, SSE, lista de sesiones y geometría de las bandas.
    .target(name: "TokencyKit"),
    // Sin Xcode no hay XCTest ni Swift Testing: las verificaciones son un ejecutable.
    .executableTarget(name: "TokencyKitChecks", dependencies: ["TokencyKit"]),
    .executableTarget(name: "TokencyMac", dependencies: ["TokencyKit"]),
  ]
)
