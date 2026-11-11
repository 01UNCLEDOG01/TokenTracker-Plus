import Foundation

// Standalone proof for the shared widget formatter. The same WidgetFormatSettings
// code compiles into the app and the widget extension; this harness pins the
// exact numbers the owner sees (CNY @ 6.687755, chinese units).
//
//   swiftc -o /tmp/widget-format-check \
//     TokenTrackerBar/Shared/WidgetSnapshot.swift scripts/widget-format-check.swift
//   /tmp/widget-format-check

func expect(_ actual: String, _ expected: String, _ label: String) {
    let ok = actual == expected
    print("\(ok ? "PASS" : "FAIL") \(label): \(actual) (expected \(expected))")
    if !ok { exit(1) }
}

@main
struct WidgetFormatCheck {
    static func main() throws {
        let chineseCNY = WidgetFormatSettings(
            tokenUnitSystem: "chinese",
            currencyCode: "CNY",
            currencySymbol: "¥",
            exchangeRate: 6.687755
        )
        let englishUSD = WidgetFormatSettings.defaults

        // Owner's real snapshot numbers (2026-11-12): today 231,894,794 tokens / $2.880133.
        expect(chineseCNY.tokens(231_894_794), "2.3亿", "owner today tokens")
        expect(chineseCNY.cost(usd: 2.880133), "¥19.26", "owner today cost")
        expect(chineseCNY.tokens(228_300_000), "2.3亿", "2.3 yi")
        expect(chineseCNY.tokens(5_000_000_000), "50亿", "50 yi")
        expect(chineseCNY.tokens(3_300_000_000), "33亿", "7d 33 yi")
        expect(chineseCNY.tokens(9_999), "9999", "below wan is exact")
        expect(chineseCNY.tokens(12_345), "1.2万", "1.2 wan")
        expect(chineseCNY.tokens(123_456_789), "1.2亿", "1.2 yi")
        expect(chineseCNY.tokens(99_999_999), "1亿", "carry 10000wan -> 1yi")
        expect(chineseCNY.tokens(1_000_000_000_000), "1万亿", "1 wan yi")
        expect(chineseCNY.cost(usd: 1.0), "¥6.69", "1 USD at owner rate")
        expect(chineseCNY.cost(usd: 0.0), "¥0.00", "zero cost")

        // English fallback (owner flips units back / schema-2 snapshot).
        expect(englishUSD.tokens(12_345), "12.3K", "english 12.3K")
        expect(englishUSD.tokens(2_300_000), "2.3M", "english 2.3M")
        expect(englishUSD.tokens(5_000_000_000), "5.0B", "english 5.0B")
        expect(englishUSD.cost(usd: 2.880133), "$2.88", "english USD cost")
        expect(englishUSD.cost(usd: 1234.5), "$1,234.50", "grouped USD cost")

        // Schema tolerance: a v2 file (no format block) still decodes, then
        // renders english/USD; a v3 file carries chinese/CNY.
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let v2 = """
        {"schemaVersion":2,"generatedAt":"2026-11-12T00:00:00Z","serverOnline":true,
         "today":{"tokens":231894794,"costUsd":2.880133,"conversations":1,"activeDays":1},
         "last7d":{"tokens":0,"costUsd":0,"conversations":0,"activeDays":0},
         "last30d":{"tokens":0,"costUsd":0,"conversations":0,"activeDays":0},
         "total":{"tokens":0,"costUsd":0,"conversations":0,"activeDays":0},
         "selected":{"tokens":0,"costUsd":0,"conversations":0,"activeDays":0},
         "dailyTrend":[],"topModels":[],"sources":[],
         "heatmap":{"weeks":[],"activeDays":0,"streakDays":0},"limits":[]}
        """
        let old = try decoder.decode(WidgetSnapshot.self, from: Data(v2.utf8))
        expect(String(old.schemaVersion), "2", "schema-2 decodes")
        expect(old.resolvedFormat.tokens(old.today.tokens), "231.9M", "schema-2 defaults to english")
        let v3 = v2.replacingOccurrences(of: "\"schemaVersion\":2", with: "\"schemaVersion\":3")
            .replacingOccurrences(of: "\"limits\":[]",
                with: "\"limits\":[],\"format\":{\"tokenUnitSystem\":\"chinese\",\"currencyCode\":\"CNY\",\"currencySymbol\":\"¥\",\"exchangeRate\":6.687755}")
        let fresh = try decoder.decode(WidgetSnapshot.self, from: Data(v3.utf8))
        expect(fresh.resolvedFormat.tokens(fresh.today.tokens), "2.3亿", "schema-3 chinese token")
        expect(fresh.resolvedFormat.cost(usd: fresh.today.costUsd), "¥19.26", "schema-3 CNY cost")

        // Runtime proof mode: point the harness at the snapshot the app just
        // wrote and print exactly what the widget would render.
        //   /tmp/widget-format-check <path>/widget-snapshot.json
        if CommandLine.arguments.count > 1 {
            let path = CommandLine.arguments[1]
            let fileData = try Data(contentsOf: URL(fileURLWithPath: path))
            let live = try decoder.decode(WidgetSnapshot.self, from: fileData)
            print("LIVE schema=\(live.schemaVersion) unit=\(live.resolvedFormat.tokenUnitSystem) "
                + "currency=\(live.resolvedFormat.currencySymbol) rate=\(live.resolvedFormat.exchangeRate)")
            print("LIVE today tokens=\(live.today.tokens) -> \(live.resolvedFormat.tokens(live.today.tokens))")
            print("LIVE today cost=\(live.today.costUsd) -> \(live.resolvedFormat.cost(usd: live.today.costUsd))")
            print("LIVE 7d tokens=\(live.last7d.tokens) -> \(live.resolvedFormat.tokens(live.last7d.tokens))")
            print("LIVE 30d tokens=\(live.last30d.tokens) -> \(live.resolvedFormat.tokens(live.last30d.tokens))")
        }
        print("HARNESS OK")
    }
}
