public enum AppleScriptBuilder {
    private static let settingsURL = "x-apple.systempreferences:com.apple.Accessibility-Settings.extension?colorFilters"

    public static func readScript() -> String {
        """
        on ensureSettingsWindow()
            do shell script "open '\(settingsURL)'"
            repeat 50 times
                tell application "System Events" to tell process "System Settings"
                    if (count windows) > 0 then return true
                end tell
                delay 0.1
            end repeat
            error "System Settings did not open"
        end ensureSettingsWindow

        on valueForControl(controlRole, settingNames)
            my ensureSettingsWindow()
            tell application "System Events" to tell process "System Settings"
                set settingsScrollArea to UI element 1 of UI element 1 of UI element 4 of UI element 1 of group 1 of window 1
                repeat with groupIndex from 1 to count UI elements of settingsScrollArea
                    set groupElement to UI element groupIndex of settingsScrollArea
                    if role of groupElement is "AXGroup" then
                        repeat with controlIndex from 1 to count UI elements of groupElement
                            set controlElement to UI element controlIndex of groupElement
                            if role of controlElement is controlRole then
                                set controlName to ""
                                try
                                    set controlName to name of controlElement as text
                                end try
                                repeat with settingName in settingNames
                                    if controlName is (contents of settingName) then
                                        return value of controlElement as text
                                    end if
                                end repeat
                            end if
                        end repeat
                    end if
                end repeat
            end tell
            error "Setting not found"
        end valueForControl

        set contrastValue to valueForControl("AXCheckBox", {"增强对比度", "Increase Contrast"})
        set differentiateValue to valueForControl("AXCheckBox", {"无需用颜色区分", "Differentiate Without Color"})
        set filterValue to valueForControl("AXCheckBox", {"色彩滤镜", "Color Filters"})
        set filterTypeValue to valueForControl("AXPopUpButton", {"滤镜类型", "Filter Type"})
        return contrastValue & "|" & differentiateValue & "|" & filterValue & "|" & filterTypeValue
        """
    }

    public static func applyScript(
        _ baseline: AccessibilityBaseline,
        currentFilterType: String? = nil
    ) throws -> String {
        let contrast = baseline.increaseContrast ? "true" : "false"
        let differentiate = baseline.differentiateWithoutColor ? "true" : "false"
        let filterEnabled = baseline.colorFilterEnabled ? "true" : "false"
        let escapedFilterType = escapeAppleScriptString(baseline.colorFilterType)
        let filterTypeCall = currentFilterType == baseline.colorFilterType
            ? ""
            : "\nchooseFilterType({\"\(escapedFilterType)\"})"

        return """
        set targetContrast to \(contrast)
        set targetDifferentiate to \(differentiate)
        set targetFilterEnabled to \(filterEnabled)
        set targetFilterType to "\(escapeAppleScriptString(baseline.colorFilterType))"

        on ensureSettingsWindow()
            do shell script "open '\(settingsURL)'"
            repeat 50 times
                tell application "System Events" to tell process "System Settings"
                    if (count windows) > 0 then return true
                end tell
                delay 0.1
            end repeat
            error "System Settings did not open"
        end ensureSettingsWindow

        on ensureCheckbox(settingNames, desiredValue)
            my ensureSettingsWindow()
            tell application "System Events" to tell process "System Settings"
                set settingsScrollArea to UI element 1 of UI element 1 of UI element 4 of UI element 1 of group 1 of window 1
                repeat with groupIndex from 1 to count UI elements of settingsScrollArea
                    set groupElement to UI element groupIndex of settingsScrollArea
                    if role of groupElement is "AXGroup" then
                        repeat with controlIndex from 1 to count UI elements of groupElement
                            set controlElement to UI element controlIndex of groupElement
                            if role of controlElement is "AXCheckBox" then
                                set controlName to ""
                                try
                                    set controlName to name of controlElement as text
                                end try
                                set isTarget to false
                                repeat with settingName in settingNames
                                    if controlName is (contents of settingName) then set isTarget to true
                                end repeat
                                if isTarget then
                                    set currentValue to value of controlElement as integer
                                    set desiredInteger to 0
                                    if desiredValue then set desiredInteger to 1
                                    if currentValue is not desiredInteger then
                                        click controlElement
                                        repeat 30 times
                                            set currentValue to value of controlElement as integer
                                            if currentValue is desiredInteger then exit repeat
                                            delay 0.1
                                        end repeat
                                    end if
                                    if currentValue is desiredInteger then return true
                                end if
                            end if
                        end repeat
                    end if
                end repeat
            end tell
            error "Checkbox not found"
        end ensureCheckbox

        on chooseFilterType(settingNames)
            delay 1
            my ensureSettingsWindow()
            repeat 50 times
                if my filterPopupExists(settingNames) then exit repeat
                delay 0.1
            end repeat
            if not my filterPopupExists(settingNames) then error "Filter type control not found"
            tell application "System Events" to tell process "System Settings"
                set settingsScrollArea to UI element 1 of UI element 1 of UI element 4 of UI element 1 of group 1 of window 1
                repeat with groupIndex from 1 to count UI elements of settingsScrollArea
                    set groupElement to UI element groupIndex of settingsScrollArea
                    if role of groupElement is "AXGroup" then
                        repeat with controlIndex from 1 to count UI elements of groupElement
                            set controlElement to UI element controlIndex of groupElement
                            if role of controlElement is "AXPopUpButton" then
                                set controlName to ""
                                try
                                    set controlName to name of controlElement as text
                                end try
                                set isTarget to false
                                repeat with settingName in settingNames
                                    if controlName is (contents of settingName) then set isTarget to true
                                end repeat
                                if isTarget then
                                    set currentValue to ""
                                    try
                                        set currentValue to value of controlElement as text
                                    end try
                                    repeat with settingName in settingNames
                                        if currentValue is (contents of settingName) then return true
                                    end repeat
                                    perform action "AXPress" of controlElement
                                    delay 0.2
                                    repeat with menuItem in menu items of menu 1 of controlElement
                                        set menuItemName to ""
                                        try
                                            set menuItemName to name of menuItem as text
                                        end try
                                        repeat with settingName in settingNames
                                            if menuItemName is (contents of settingName) then
                                                click menuItem
                                                delay 0.3
                                                return true
                                            end if
                                        end repeat
                                    end repeat
                                    key code 53
                                end if
                            end if
                        end repeat
                    end if
                end repeat
            end tell
            error "Filter type control not found"
        end chooseFilterType

        on filterPopupExists(settingNames)
            tell application "System Events" to tell process "System Settings"
                set settingsScrollArea to UI element 1 of UI element 1 of UI element 4 of UI element 1 of group 1 of window 1
                repeat with groupIndex from 1 to count UI elements of settingsScrollArea
                    set groupElement to UI element groupIndex of settingsScrollArea
                    if role of groupElement is "AXGroup" then
                        repeat with controlIndex from 1 to count UI elements of groupElement
                            set controlElement to UI element controlIndex of groupElement
                            if role of controlElement is "AXPopUpButton" then
                                set controlName to ""
                                try
                                    set controlName to name of controlElement as text
                                end try
                                repeat with settingName in settingNames
                                    if controlName is (contents of settingName) then return true
                                end repeat
                            end if
                        end repeat
                    end if
                end repeat
            end tell
            return false
        end filterPopupExists

        ensureCheckbox({"增强对比度", "Increase Contrast"}, targetContrast)
        ensureCheckbox({"无需用颜色区分", "Differentiate Without Color"}, targetDifferentiate)
        ensureCheckbox({"色彩滤镜", "Color Filters"}, true)
        \(filterTypeCall)
        ensureCheckbox({"色彩滤镜", "Color Filters"}, targetFilterEnabled)
        delay 0.3
        tell application "System Settings" to quit
        """
    }

    private static func escapeAppleScriptString(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
    }
}
