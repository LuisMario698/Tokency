import AppKit
import SwiftUI

@main
struct TokencyApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

  var body: some Scene {
    MenuBarExtra {
      MenuView(model: delegate.model)
    } label: {
      MenuBarLabel(model: delegate.model)
    }
    .menuBarExtraStyle(.window)

    Window("Historial de uso", id: UsageHistoryView.windowID) {
      UsageHistoryView(model: delegate.model, history: delegate.model.history)
    }
    .defaultSize(width: 760, height: 720)
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  let model = AppModel()

  func applicationWillFinishLaunching(_ notification: Notification) {
    // Sin ícono en el Dock aunque se ejecute fuera del .app (LSUIElement hace lo mismo en el bundle).
    NSApp.setActivationPolicy(.accessory)
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    // Una sola instancia: el ítem de inicio y una apertura manual no deben duplicar las bandas.
    if let bundleId = Bundle.main.bundleIdentifier,
      NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).count > 1
    {
      NSApp.terminate(nil)
      return
    }
    model.start()
  }
}
