use raw_window_handle::{HasDisplayHandle, HasWindowHandle, RawDisplayHandle, RawWindowHandle};
use tauri::WebviewWindow;
use wayland_client::{
    backend::{Backend, ObjectId},
    delegate_noop,
    protocol::{wl_registry, wl_surface::WlSurface},
    Connection, Dispatch, EventQueue, Proxy, QueueHandle,
};
use wayland_protocols::wp::idle_inhibit::zv1::client::{
    zwp_idle_inhibit_manager_v1::ZwpIdleInhibitManagerV1, zwp_idle_inhibitor_v1::ZwpIdleInhibitorV1,
};

#[derive(Default)]
struct Globals {
    manager: Option<ZwpIdleInhibitManagerV1>,
}

impl Dispatch<wl_registry::WlRegistry, ()> for Globals {
    fn event(
        state: &mut Self,
        registry: &wl_registry::WlRegistry,
        event: wl_registry::Event,
        _: &(),
        _: &Connection,
        queue: &QueueHandle<Self>,
    ) {
        if let wl_registry::Event::Global {
            name, interface, ..
        } = event
        {
            if interface == "zwp_idle_inhibit_manager_v1" {
                state.manager = Some(registry.bind(name, 1, queue, ()));
            }
        }
    }
}

delegate_noop!(Globals: ignore ZwpIdleInhibitManagerV1);
delegate_noop!(Globals: ignore ZwpIdleInhibitorV1);

pub struct Inhibitor {
    inhibitor: Option<ZwpIdleInhibitorV1>,
    manager: ZwpIdleInhibitManagerV1,
    connection: Connection,
    _queue: EventQueue<Globals>,
}

impl Inhibitor {
    pub fn acquire(window: &WebviewWindow) -> Result<Self, String> {
        let display = window.display_handle().map_err(|e| e.to_string())?;
        let surface = window.window_handle().map_err(|e| e.to_string())?;
        let (RawDisplayHandle::Wayland(display), RawWindowHandle::Wayland(surface)) =
            (display.as_raw(), surface.as_raw())
        else {
            return Err("The clock is not running as a native Wayland window".into());
        };
        // Borrow GTK's display and surface. This backend owns a separate event
        // queue and never disconnects GTK's display or destroys its surface.
        // main.rs releases the guard before the application window closes.
        let backend = unsafe { Backend::from_foreign_display(display.display.as_ptr().cast()) };
        let connection = Connection::from_backend(backend);
        let id =
            unsafe { ObjectId::from_ptr(WlSurface::interface(), surface.surface.as_ptr().cast()) }
                .map_err(|e| e.to_string())?;
        let surface = WlSurface::from_id(&connection, id).map_err(|e| e.to_string())?;
        let mut queue = connection.new_event_queue();
        let handle = queue.handle();
        let _registry = connection.display().get_registry(&handle, ());
        let mut globals = Globals::default();
        queue.roundtrip(&mut globals).map_err(|e| e.to_string())?;
        let manager = globals
            .manager
            .ok_or("The compositor does not support Wayland idle inhibition")?;
        let inhibitor = manager.create_inhibitor(&surface, &handle, ());
        let guard = Self {
            inhibitor: Some(inhibitor),
            manager,
            connection,
            _queue: queue,
        };
        guard.connection.flush().map_err(|e| e.to_string())?;
        Ok(guard)
    }

    pub fn release(&mut self) -> Result<(), String> {
        if let Some(inhibitor) = self.inhibitor.take() {
            inhibitor.destroy();
        }
        self.connection.flush().map_err(|e| e.to_string())
    }
}

impl Drop for Inhibitor {
    fn drop(&mut self) {
        let _ = self.release();
        self.manager.destroy();
        let _ = self.connection.flush();
    }
}
