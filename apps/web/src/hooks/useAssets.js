"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useAssets = useAssets;
exports.usePlatformStats = usePlatformStats;
exports.usePairFilters = usePairFilters;
var react_query_1 = require("@tanstack/react-query");
var assetService_1 = require("../services/assetService");
function useAssets() {
    return (0, react_query_1.useQuery)({
        queryKey: ["assets"],
        queryFn: function () { return assetService_1.assetService.getAssets(); },
    });
}
function usePlatformStats() {
    return (0, react_query_1.useQuery)({
        queryKey: ["platformStats"],
        queryFn: function () { return assetService_1.assetService.getPlatformStats(); },
    });
}
function usePairFilters() {
    return (0, react_query_1.useQuery)({
        queryKey: ["pairFilters"],
        queryFn: function () { return assetService_1.assetService.getPairFilters(); },
    });
}
