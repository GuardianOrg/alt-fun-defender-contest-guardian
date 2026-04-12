"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useTokens = useTokens;
exports.useTokensByDirection = useTokensByDirection;
var react_query_1 = require("@tanstack/react-query");
var tokenService_1 = require("../services/tokenService");
function useTokens(filter) {
    return (0, react_query_1.useQuery)({
        queryKey: ["tokens", filter],
        queryFn: function () { return tokenService_1.tokenService.getTokens(filter); },
    });
}
function useTokensByDirection(direction, filter) {
    return (0, react_query_1.useQuery)({
        queryKey: ["tokens", direction, filter],
        queryFn: function () { return tokenService_1.tokenService.getTokensByDirection(direction, filter); },
        refetchInterval: 10000,
    });
}
