import QtQuick
import Quickshell
import Quickshell.Wayland
Scope {
    IdleMonitor {
        timeout: 5
        respectInhibitors: true
        onIsIdleChanged: console.log('HORIZON_QA respecting idle=' + isIdle)
        Component.onCompleted: console.log('HORIZON_QA respecting ready idle=' + isIdle)
    }
    IdleMonitor {
        timeout: 5
        respectInhibitors: false
        onIsIdleChanged: console.log('HORIZON_QA input-only idle=' + isIdle)
        Component.onCompleted: console.log('HORIZON_QA input-only ready idle=' + isIdle)
    }
}
