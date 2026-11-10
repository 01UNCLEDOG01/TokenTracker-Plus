import AppKit

/// The floating pill's accent dot colour — the Swift twin of
/// `dashboard/src/lib/pet-appearance.js` (PET_PILL_DOT_COLORS / PET_PILL_DOT_FALLBACK)
/// and `bot-appearance.js` (botPillDotHex). Windows tints the same dot through
/// TokenTrackerWin/MonitorWidgetWindow.ApplyStyle; keeping this table in sync is
/// what makes "the pet you chose" and "the dot" read as one feature.
///
/// Unknown/community pets keep the neutral gray (that is why 庚戌/gengxu is gray),
/// bot follows its body colour (theme "auto" or the user's pinned palette entry),
/// and the built-ins use the main colour of their own art.
enum PetPillAppearance {
    struct RGB: Equatable {
        let r: Int
        let g: Int
        let b: Int
    }

    /// dashboard/src/lib/pet-appearance.js PET_PILL_DOT_COLORS.
    static let characterColors: [String: RGB] = [
        "clawd": RGB(r: 217, g: 119, b: 87),   // #d97757
        "byte": RGB(r: 43, g: 58, b: 140),     // #2b3a8c
        "sprout": RGB(r: 34, g: 197, b: 94),   // #22c55e
        "ember": RGB(r: 239, g: 108, b: 77),   // #ef6c4d
        "yeacat": RGB(r: 240, g: 153, b: 63),  // #f0993f
    ]

    /// dashboard/src/lib/bot/skins.ts COLORS (id -> hex), the palette the bot
    /// body colour picker offers plus the two "auto" ends.
    static let botColors: [String: RGB] = [
        "encre": RGB(r: 10, g: 10, b: 12),
        "brun": RGB(r: 139, g: 94, b: 60),
        "rouge": RGB(r: 232, g: 72, b: 63),
        "orange": RGB(r: 240, g: 138, b: 36),
        "ambre": RGB(r: 240, g: 180, b: 41),
        "vert": RGB(r: 62, g: 207, b: 142),
        "turquoise": RGB(r: 47, g: 191, b: 160),
        "bleu": RGB(r: 59, g: 147, b: 240),
        "violet": RGB(r: 139, g: 92, b: 246),
        "rose": RGB(r: 225, g: 82, b: 176),
        "gris": RGB(r: 163, g: 163, b: 163),
        "creme": RGB(r: 241, g: 239, b: 233),
    ]

    /// Neutral gray for unknown/community pets (PET_PILL_DOT_FALLBACK #9ca3af).
    static let fallback = RGB(r: 156, g: 163, b: 175)

    static func normalizeCharacter(_ raw: String) -> String {
        raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// bot's "auto" body colour follows the theme (ink on light, cream on dark);
    /// a pinned palette id is theme-independent (bot-appearance.js resolveBotColor).
    static func resolveBotColor(_ preference: String, isDark: Bool) -> String {
        let id = preference.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let choices = ["bleu", "turquoise", "vert", "ambre", "rose", "violet"]
        if id == "auto" || !choices.contains(id) {
            return isDark ? "creme" : "encre"
        }
        return id
    }

    static func dotColor(character: String, botColor: String, isDark: Bool) -> RGB {
        let id = normalizeCharacter(character)
        if id == "bot" {
            return botColors[resolveBotColor(botColor, isDark: isDark)] ?? fallback
        }
        return characterColors[id] ?? fallback
    }

    static func nsColor(_ rgb: RGB) -> NSColor {
        NSColor(calibratedRed: CGFloat(rgb.r) / 255,
                green: CGFloat(rgb.g) / 255,
                blue: CGFloat(rgb.b) / 255,
                alpha: 1)
    }
}
