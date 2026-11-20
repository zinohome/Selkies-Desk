# GNOME Wayland 剪贴板兼容补丁

这是 **Linux 远端 Selkies 服务的补丁**，适用于本次实测的 Selkies 2.2.1 Python 构建与 GNOME Shell 50.1。Selkies Desk 客户端仍为 0.5.1，无需重新安装客户端。

## 故障与修复

客户端的剪贴板权限、WebSocket 连接及发送消息正常，但服务器日志报告：

```text
data-control clipboard write failed: app compositor advertises neither ext_data_control_manager_v1 nor zwlr_data_control_manager_v1
```

该服务器通过 Wayland 捕获 GNOME 会话，剪贴板却走不受此合成器支持的 data-control 接口。客户端的发送、接收、无缝同步、图像开关无法补齐服务器缺失的接口。

补丁增加显式启用的 `SELKIES_CLIPBOARD_XWAYLAND=1` 兼容方式，复用服务已有的 XFixes / XWayland 剪贴板实现，提供文本、PNG 与更改通知。它只使用服务进程当前 `DISPLAY` 指向的活动 XWayland；没有该显示服务时返回失败，不搜索其他用户或虚拟桌面。原有 Wayland 捕获和键鼠路径保持原有实现。

没有设置该变量时沿用原有剪贴板路径。这个补丁不安装 `xclip`，也不启用 Selkies 的远端命令执行功能。

## 安装

在运行 `selkies.service` 的 **Linux 登录账户** 下执行。该服务必须是用户级 systemd 服务，并使用 `/opt/selkies/bin/python3`。其他部署布局需要先核对。

```sh
/opt/selkies/bin/python3 install.py --activate
systemctl --user restart selkies.service
```

安装器会先核对原始 `input_handler.py` 的 SHA256，创建用户目录下的兼容副本、应用补丁、检查新文件校验和及 Python 语法，并执行回归测试。通过后才写入 `selkies.service` 的单独配置：

```ini
[Service]
Environment="PYTHONPATH=/home/你的账户/.local/share/selkies-gnome-clipboard-r1"
Environment="SELKIES_CLIPBOARD_XWAYLAND=1"
```

以上路径由安装器根据当前账户生成，不应照抄示例。原始 `/opt/selkies` 包文件不会被改写。服务原有 `PYTHONPATH` 已有配置或目标路径已存在时，安装器会停止，避免覆盖。

重启只影响该远端 Selkies 服务，连接会短暂中断。重新连接后测试实际远端应用的复制、粘贴；图像测试需双方启用图像支持。

仅运行 `install.py` 会准备副本并测试，不写服务配置。如需随后激活，先保留或清理此次生成的暂存目录，再执行 `--activate`；安装器不会覆盖已存在的目录。

## 回退

保留此目录中的 `install.py`：

```sh
/opt/selkies/bin/python3 install.py --rollback
systemctl --user restart selkies.service
```

回退只移除本补丁的独立服务配置，重新使用原始软件包。若配置被手动更改，脚本停止，避免删除其他修改。兼容副本保留在用户目录供核对。

升级远端 Selkies 前先回退此补丁；原始源码校验不匹配时不能将它直接套用到其他构建。此补丁依赖 GNOME 对当前会话 XWayland 剪贴板的桥接，不承诺其他合成器、独立 Wayland 沙箱或所有应用格式的兼容性。

## 回归测试

测试通过 AST 提取目标文件的实际剪贴板方法执行，模拟的仅为显示服务边界，不需要在 macOS 上导入 Linux 图形库：

```sh
SELKIES_CLIPBOARD_TEST_SOURCE=/path/to/selkies/input_handler.py \
  python3 test_clipboard.py
```

覆盖文本、图片、再次读取服务自有剪贴板、无缝同步监视器、默认路径、缺少显示服务和原生写入失败。修复前 9 项测试中 6 项失败，修复后全部通过；安装器在 Linux 上也会重新执行。

`probe.py` 用于真机验证当前登录会话的 XWayland 剪贴板，只读写固定测试文本或 12 × 10 的色块 PNG，并将布尔结果写入指定的 JSON 文件。写入测试会持有剪贴板 8 秒。运行它会替换测试机的当前剪贴板，请在测试会话中使用。
