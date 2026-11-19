import AppKit
import EInkCore
import Foundation

let arguments = Set(CommandLine.arguments.dropFirst())
let store: SettingsStore
do {
    store = SettingsStore(directory: try SettingsStore.defaultDirectory())
} catch {
    fputs("无法创建配置目录：\(error)\n", stderr)
    exit(1)
}

if arguments.contains("--help") {
    print(
        """
        用法：
          EInkSwitch                启动菜单栏应用
          EInkSwitch --status       读取三项系统设置
          EInkSwitch --eink         记录当前状态并进入墨水屏模式
          EInkSwitch --normal       恢复记录的普通模式
          EInkSwitch --defaults     恢复三项默认关闭
        """
    )
    exit(0)
}

let controller = SystemSettingsController()
if arguments.contains("--status") {
    do {
        let baseline = try controller.read()
        print("增强对比度：\(baseline.increaseContrast)")
        print("无需用颜色区分：\(baseline.differentiateWithoutColor)")
        print("色彩滤镜：\(baseline.colorFilterEnabled)")
        print("滤镜类型：\(baseline.colorFilterType)")
    } catch {
        fputs("\(error.localizedDescription)\n", stderr)
        exit(1)
    }
    exit(0)
}

if arguments.contains("--eink") || arguments.contains("--normal") || arguments.contains("--defaults") {
    do {
        if arguments.contains("--eink") {
            let baseline = try controller.read()
            try store.save(baseline)
            try controller.apply(SystemSettingsController.einkBaseline)
        } else if arguments.contains("--normal"), let baseline = try store.load() {
            try controller.apply(baseline)
            try store.delete()
        } else {
            try controller.apply(SystemSettingsController.disabledBaseline)
            try store.delete()
        }
        print("完成")
    } catch {
        fputs("\(error.localizedDescription)\n", stderr)
        exit(1)
    }
    exit(0)
}

let application = NSApplication.shared
let appDelegate = AppDelegate(store: store)
application.delegate = appDelegate
application.setActivationPolicy(.accessory)
application.run()
