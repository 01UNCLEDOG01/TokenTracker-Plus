import Foundation

enum Constants {
    static let serverBaseURL = NativeQAProfile.current?.origin ?? "http://localhost:17680"
    static let serverPort = NativeQAProfile.current?.baseURL.port ?? 17680
    static let autoRefreshInterval: TimeInterval = 300
    static let healthCheckInterval: TimeInterval = 30
    static let maxHeatmapWeeks = 52
}
