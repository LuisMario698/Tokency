import Foundation

public struct SSEMessage: Sendable, Equatable {
  public var event: String
  public var data: String

  public init(event: String, data: String) {
    self.event = event
    self.data = data
  }
}

/// Parser de `text/event-stream` línea por línea. Un mensaje termina con una línea vacía.
/// (`URLSession.AsyncBytes.lines` omite las líneas vacías, por eso la app parte las líneas ella misma.)
public struct SSEParser: Sendable {
  private var event = ""
  private var data: [String] = []

  public init() {}

  /// Recibe una línea sin el salto final; devuelve un mensaje cuando se completa.
  public mutating func feed(line rawLine: String) -> SSEMessage? {
    let line = rawLine.hasSuffix("\r") ? String(rawLine.dropLast()) : rawLine
    if line.isEmpty {
      defer {
        event = ""
        data = []
      }
      guard !data.isEmpty else { return nil }
      return SSEMessage(event: event.isEmpty ? "message" : event, data: data.joined(separator: "\n"))
    }
    if line.hasPrefix(":") { return nil }  // Comentario.
    let (field, value) = Self.split(line)
    switch field {
    case "event": event = value
    case "data": data.append(value)
    default: break  // `id`, `retry` y campos desconocidos no se usan.
    }
    return nil
  }

  private static func split(_ line: String) -> (String, String) {
    guard let colon = line.firstIndex(of: ":") else { return (line, "") }
    var value = line[line.index(after: colon)...]
    if value.hasPrefix(" ") { value = value.dropFirst() }
    return (String(line[..<colon]), String(value))
  }
}

/// Parte bytes en líneas conservando las vacías, que en SSE separan los mensajes.
public struct LineSplitter: Sendable {
  private var buffer: [UInt8] = []

  public init() {}

  public mutating func feed(_ byte: UInt8) -> String? {
    guard byte == 0x0A else {
      buffer.append(byte)
      return nil
    }
    defer { buffer.removeAll(keepingCapacity: true) }
    return String(decoding: buffer, as: UTF8.self)
  }
}
