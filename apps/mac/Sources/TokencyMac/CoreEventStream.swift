import Foundation
import TokencyKit

enum CoreStreamError: Error, LocalizedError {
  case status(Int)
  case closed

  var errorDescription: String? {
    switch self {
    case .status(401): "El core rechazó el token; ejecuta `tokency install`."
    case .status(let code): "El core respondió \(code)."
    case .closed: "Se cortó la conexión con el core."
    }
  }
}

/// Eventos en vivo de `GET /v1/events`. Se leen byte a byte fuera del hilo principal para
/// conservar las líneas vacías que separan los mensajes SSE.
enum CoreEventStream {
  static func events(endpoint: CoreEndpoint) -> AsyncThrowingStream<LiveEvent, Error> {
    AsyncThrowingStream { continuation in
      let task = Task.detached {
        do {
          var request = URLRequest(url: endpoint.eventsURL)
          request.setValue("Bearer \(endpoint.token)", forHTTPHeaderField: "Authorization")
          request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
          // El core manda un ping cada 15 s: si pasan 45 s sin datos, la conexión murió.
          request.timeoutInterval = 45
          let (bytes, response) = try await URLSession.shared.bytes(for: request)
          let status = (response as? HTTPURLResponse)?.statusCode ?? 0
          guard status == 200 else { throw CoreStreamError.status(status) }
          var splitter = LineSplitter()
          var parser = SSEParser()
          for try await byte in bytes {
            guard let line = splitter.feed(byte), let message = parser.feed(line: line) else { continue }
            if let event = try LiveEvent.decode(message) { continuation.yield(event) }
          }
          continuation.finish(throwing: CoreStreamError.closed)
        } catch {
          continuation.finish(throwing: error)
        }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }
}
