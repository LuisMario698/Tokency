// Verificaciones de TokencyKit. Sin Xcode no hay XCTest ni Swift Testing (D-012), así que esto
// es un ejecutable: `swift run TokencyKitChecks` sale con 1 si algo falla.

import CoreGraphics
import Foundation
import TokencyKit

nonisolated(unsafe) var failures: [String] = []
nonisolated(unsafe) var passed = 0

func check(_ condition: @autoclosure () throws -> Bool, _ name: String, line: Int = #line) {
  do {
    if try condition() {
      passed += 1
    } else {
      failures.append("línea \(line): \(name)")
    }
  } catch {
    failures.append("línea \(line): \(name) lanzó \(error)")
  }
}

func session(_ id: String, _ state: SessionState, startedAt: Double = 0) -> Session {
  Session(
    id: id, sessionId: id, pid: 1, state: state, origin: SessionOrigin(kind: .cli, bundleId: "com.apple.Terminal"),
    projectName: "repo", startedAt: startedAt, stateChangedAt: startedAt, lastActivityAt: startedAt)
}

func sessionJSON(_ id: String, _ state: String, startedAt: Int = 0) -> String {
  """
  {"id":"\(id)","sessionId":"\(id)","pid":10,"state":"\(state)","source":"hooks",\
  "origin":{"kind":"ide","entrypoint":"claude-vscode","bundleId":"com.google.antigravity-ide","termProgram":null},\
  "cwd":"/repo","projectName":"repo","transcriptPath":null,"model":null,"permissionMode":"auto",\
  "lastPrompt":"hola","startedAt":\(startedAt),"stateChangedAt":\(startedAt),"lastActivityAt":\(startedAt),\
  "lastEventTs":1,"endedAt":null,"endReason":null,"campoNuevo":true}
  """
}

// MARK: - SSE

do {
  var parser = SSEParser()
  let lines = [
    ": comentario", "event: snapshot", "data: {\"a\":1}", "", "event: ping", "data: {}", "\r",
    "data: sin nombre", "", "", "id: 7",
  ]
  let messages = lines.compactMap { parser.feed(line: $0) }
  check(
    messages == [
      SSEMessage(event: "snapshot", data: "{\"a\":1}"),
      SSEMessage(event: "ping", data: "{}"),
      SSEMessage(event: "message", data: "sin nombre"),
    ], "SSEParser arma mensajes y respeta comentarios, CR y líneas vacías")

  var multi = SSEParser()
  _ = multi.feed(line: "data: uno")
  _ = multi.feed(line: "data:dos")
  check(multi.feed(line: "") == SSEMessage(event: "message", data: "uno\ndos"), "SSEParser une varias líneas data")

  var splitter = LineSplitter()
  let lines2 = Array("a\n\nbc\n".utf8).compactMap { splitter.feed($0) }
  check(lines2 == ["a", "", "bc"], "LineSplitter conserva las líneas vacías")
}

// MARK: - Eventos en vivo

do {
  let snapshot = try LiveEvent.decode(
    SSEMessage(event: "snapshot", data: "{\"type\":\"snapshot\",\"sessions\":[\(sessionJSON("a", "working"))]}"))
  if case .snapshot(let sessions) = snapshot {
    check(sessions.count == 1, "snapshot trae una sesión")
    check(sessions.first?.origin.bundleId == "com.google.antigravity-ide", "decodifica el origen")
    check(sessions.first?.lastPrompt == "hola", "decodifica el último prompt e ignora campos nuevos")
  } else {
    check(false, "decodifica snapshot")
  }
  let updated = try LiveEvent.decode(
    SSEMessage(event: "session.updated", data: "{\"type\":\"session.updated\",\"session\":\(sessionJSON("b", "waiting"))}"))
  check(
    { if case .updated(let s) = updated { return s.state == .waiting }; return false }(),
    "decodifica session.updated")
  check(
    try LiveEvent.decode(SSEMessage(event: "session.removed", data: "{\"type\":\"session.removed\",\"id\":\"x\"}"))
      == .removed("x"), "decodifica session.removed")
  check(try LiveEvent.decode(SSEMessage(event: "ping", data: "{}")) == nil, "ignora ping")
} catch {
  check(false, "LiveEvent.decode lanzó \(error)")
}

// MARK: - Lista de sesiones

do {
  var list = SessionList()
  list.apply(.snapshot([session("b", .working, startedAt: 2), session("a", .idle, startedAt: 1)]))
  check(list.visible.map(\.id) == ["a", "b"], "ordena de la más antigua a la más reciente")
  list.apply(.updated(session("c", .waiting, startedAt: 3)))
  list.apply(.updated(session("a", .ended, startedAt: 1)))
  check(list.visible.map(\.id) == ["b", "c"], "agrega nuevas y quita las terminadas")
  list.apply(.removed("b"))
  check(list.visible.map(\.id) == ["c"], "quita las eliminadas")
  list.apply(.snapshot([]))
  check(list.visible.isEmpty, "un snapshot reemplaza todo")
}

// MARK: - Geometría de las bandas

do {
  let metrics = BandMetrics()
  let screen = CGRect(x: 0, y: 0, width: 1440, height: 900)
  let one = BandLayout.panelFrame(visibleFrame: screen, edge: .right, count: 1, expanded: false, metrics: metrics)
  check(one == CGRect(x: 1433, y: 418, width: 7, height: 64), "una banda colapsada, a la derecha y centrada")
  let expanded = BandLayout.panelFrame(visibleFrame: screen, edge: .left, count: 2, expanded: true, metrics: metrics)
  check(expanded == CGRect(x: 0, y: 384, width: 320, height: 132), "dos bandas expandidas a la izquierda")
  let many = BandLayout.bandHeight(count: 20, available: 900, metrics: metrics)
  check(many < metrics.bandHeight && many >= metrics.minBandHeight, "muchas bandas se achican para caber")
  let tooMany = BandLayout.bandHeight(count: 200, available: 900, metrics: metrics)
  check(tooMany == metrics.minBandHeight, "nunca bajan del alto mínimo")
  check(BandLayout.panelFrame(visibleFrame: screen, edge: .right, count: 0, expanded: false, metrics: metrics) == .zero,
    "sin sesiones no hay panel")
  let secondary = CGRect(x: -1920, y: 200, width: 1920, height: 1080)
  let onSecondary = BandLayout.panelFrame(visibleFrame: secondary, edge: .right, count: 1, expanded: false, metrics: metrics)
  check(onSecondary.maxX == secondary.maxX && onSecondary.midY.rounded() == secondary.midY, "respeta pantallas con origen negativo")
}

// MARK: - Ajustes del core

do {
  let home = FileManager.default.temporaryDirectory.appending(path: "tokency-checks-\(UUID().uuidString)")
  let support = CoreSettings.supportDirectory(home: home)
  check(CoreSettings.port(home: home, environment: [:]) == 7777, "puerto por defecto sin config.json")
  try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
  try Data("{\"port\": 8123}".utf8).write(to: support.appending(path: "config.json"))
  check(CoreSettings.port(home: home, environment: [:]) == 8123, "lee el puerto de config.json")
  check(CoreSettings.port(home: home, environment: ["TOKENCY_PORT": "9000"]) == 9000, "TOKENCY_PORT lo reemplaza")
  check(try CoreSettings.token(environment: ["TOKENCY_TOKEN": "abc"]) == "abc", "TOKENCY_TOKEN reemplaza al Llavero")
  try? FileManager.default.removeItem(at: home)
} catch {
  check(false, "CoreSettings lanzó \(error)")
}

do {
  let start = Date(timeIntervalSince1970: 0)
  check(elapsedLabel(since: start, now: Date(timeIntervalSince1970: 30)) == "<1 min", "menos de un minuto")
  check(elapsedLabel(since: start, now: Date(timeIntervalSince1970: 125 * 60)) == "2 h 5 min", "horas y minutos")
}

// MARK: - Resultado

if failures.isEmpty {
  print("TokencyKit: \(passed) verificaciones correctas.")
} else {
  print("TokencyKit: \(failures.count) fallaron, \(passed) correctas:")
  failures.forEach { print("  ✗ \($0)") }
  exit(1)
}
