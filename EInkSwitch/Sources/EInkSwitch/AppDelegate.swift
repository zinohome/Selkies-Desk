import AppKit
import Carbon.HIToolbox
import EInkCore

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private var hotKeyReference: EventHotKeyRef?
    private var isBusy = false
    private let store: SettingsStore
    private let controller = SystemSettingsController()

    init(store: SettingsStore) {
        self.store = store
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = NSImage(systemSymbolName: "circle.lefthalf.filled", accessibilityDescription: "墨水屏切换")
        statusItem.menu = buildMenu()
        self.statusItem = statusItem
        registerHotKey()
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let hotKeyReference {
            UnregisterEventHotKey(hotKeyReference)
        }
    }

    private func buildMenu() -> NSMenu {
        let savedBaseline = try? store.load()
        let menu = NSMenu()
        let toggleTitle = savedBaseline == nil ? "切换到墨水屏模式" : "切换回普通模式"
        let toggleItem = NSMenuItem(title: toggleTitle, action: #selector(toggleMode), keyEquivalent: "")
        toggleItem.target = self
        menu.addItem(toggleItem)

        let resetItem = NSMenuItem(title: "恢复三项默认关闭", action: #selector(resetToDefaults), keyEquivalent: "")
        resetItem.target = self
        menu.addItem(resetItem)
        menu.addItem(.separator())

        let stateItem = NSMenuItem(
            title: savedBaseline == nil ? "当前：普通模式" : "当前：墨水屏模式",
            action: nil,
            keyEquivalent: ""
        )
        stateItem.isEnabled = false
        menu.addItem(stateItem)

        let quitItem = NSMenuItem(title: "退出", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quitItem)
        return menu
    }

    private func registerHotKey() {
        let hotKeyID = EventHotKeyID(signature: OSType(0x45494E4B), id: 1)
        let status = RegisterEventHotKey(
            UInt32(kVK_ANSI_E),
            UInt32(cmdKey | optionKey),
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyReference
        )
        guard status == noErr else { return }

        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(
            GetApplicationEventTarget(),
            { _, _, userData -> OSStatus in
                guard let appDelegate = Unmanaged<AppDelegate>.fromOpaque(userData!).takeUnretainedValue() as AppDelegate? else {
                    return noErr
                }
                appDelegate.toggleMode()
                return noErr
            },
            1,
            &eventType,
            Unmanaged.passUnretained(self).toOpaque(),
            nil
        )
    }

    @objc private func toggleMode() {
        guard !isBusy else { return }
        isBusy = true
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                if let baseline = try self.store.load() {
                    try self.controller.apply(baseline)
                    try self.store.delete()
                } else {
                    let baseline = try self.controller.read()
                    try self.store.save(baseline)
                    try self.controller.apply(SystemSettingsController.einkBaseline)
                }
                DispatchQueue.main.async {
                    self.isBusy = false
                    self.statusItem?.menu = self.buildMenu()
                }
            } catch {
                DispatchQueue.main.async {
                    self.isBusy = false
                    self.statusItem?.menu = self.buildMenu()
                    self.presentError(error)
                }
            }
        }
    }

    @objc private func resetToDefaults() {
        guard !isBusy else { return }
        isBusy = true
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try self.controller.apply(SystemSettingsController.disabledBaseline)
                try self.store.delete()
                DispatchQueue.main.async {
                    self.isBusy = false
                    self.statusItem?.menu = self.buildMenu()
                }
            } catch {
                DispatchQueue.main.async {
                    self.isBusy = false
                    self.statusItem?.menu = self.buildMenu()
                    self.presentError(error)
                }
            }
        }
    }

    private func presentError(_ error: Error) {
        let alert = NSAlert()
        alert.messageText = "墨水屏切换失败"
        alert.informativeText = error.localizedDescription
        alert.runModal()
    }
}

