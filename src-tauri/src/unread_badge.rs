use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub(crate) struct UnreadBadge(Mutex<Option<u32>>);

impl UnreadBadge {
    pub(crate) fn publish<E>(
        &self,
        app: &AppHandle,
        active_count: impl FnOnce() -> Result<Option<u32>, E>,
    ) {
        let Ok(mut last) = self.0.lock() else { return };
        let Ok(count) = active_count() else { return };
        let count = count.unwrap_or(0);
        if *last == Some(count) {
            return;
        }
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        #[cfg(not(target_os = "windows"))]
        let result = window.set_badge_count((count > 0).then_some(i64::from(count)));
        #[cfg(target_os = "windows")]
        let result = window.set_overlay_icon(overlay_icon(count));
        if result.is_ok() {
            *last = Some(count);
        }
    }
}

#[cfg(any(target_os = "windows", test))]
fn overlay_icon(count: u32) -> Option<tauri::image::Image<'static>> {
    const SIZE: usize = 32;
    const GLYPHS: [[u8; 5]; 11] = [
        [0b111, 0b101, 0b101, 0b101, 0b111],
        [0b010, 0b110, 0b010, 0b010, 0b111],
        [0b111, 0b001, 0b111, 0b100, 0b111],
        [0b111, 0b001, 0b111, 0b001, 0b111],
        [0b101, 0b101, 0b111, 0b001, 0b001],
        [0b111, 0b100, 0b111, 0b001, 0b111],
        [0b111, 0b100, 0b111, 0b101, 0b111],
        [0b111, 0b001, 0b010, 0b010, 0b010],
        [0b111, 0b101, 0b111, 0b101, 0b111],
        [0b111, 0b101, 0b111, 0b001, 0b111],
        [0b000, 0b010, 0b111, 0b010, 0b000],
    ];
    if count == 0 {
        return None;
    }
    let label = if count > 99 {
        "99+".into()
    } else {
        count.to_string()
    };
    let mut rgba = vec![0; SIZE * SIZE * 4];
    let start_x = (SIZE - (label.len() * 8 - 2)) / 2;
    let mut paint = |x: usize, y: usize, color: [u8; 4]| {
        let pixel = 4 * (y * SIZE + x);
        rgba[pixel..pixel + 4].copy_from_slice(&color);
    };
    for y in 0..SIZE {
        for x in 0..SIZE {
            let dy = y.abs_diff(15) as f32 - 0.5;
            let dx = x.abs_diff(15) as f32 - 0.5;
            let distance = dx.max(0.0).hypot(dy.max(0.0));
            if distance < 15.0 {
                paint(x, y, [190, 28, 57, 255]);
            }
        }
    }
    for (position, character) in label.bytes().enumerate() {
        let glyph = if character == b'+' {
            10
        } else {
            usize::from(character - b'0')
        };
        for (row, bits) in GLYPHS[glyph].iter().enumerate() {
            for column in 0..3 {
                if bits & (1 << (2 - column)) == 0 {
                    continue;
                }
                for dy in 0..2 {
                    for dx in 0..2 {
                        paint(
                            start_x + position * 8 + column * 2 + dx,
                            11 + row * 2 + dy,
                            [255; 4],
                        );
                    }
                }
            }
        }
    }
    Some(tauri::image::Image::new_owned(
        rgba,
        SIZE as u32,
        SIZE as u32,
    ))
}

#[cfg(test)]
mod tests {
    use super::overlay_icon;

    #[test]
    fn hides_zero_and_renders_a_legible_capped_taskbar_overlay() {
        assert!(overlay_icon(0).is_none());
        let one = overlay_icon(1).unwrap();
        assert_eq!((one.width(), one.height()), (32, 32));
        assert!(one.rgba().chunks_exact(4).any(|pixel| pixel == [255; 4]));
        assert_ne!(one.rgba(), overlay_icon(2).unwrap().rgba());
        assert_ne!(one.rgba(), overlay_icon(100).unwrap().rgba());
        assert_eq!(
            overlay_icon(100).unwrap().rgba(),
            overlay_icon(10_000).unwrap().rgba()
        );
    }
}
