"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useToken = useToken;
var react_query_1 = require("@tanstack/react-query");
var tokenService_1 = require("../services/tokenService");
function useToken(address) {
    return (0, react_query_1.useQuery)({
        queryKey: ["token", address],
        queryFn: function () {
            if (!address)
                throw new Error("Address required");
            return tokenService_1.tokenService.getToken(address);
        },
        enabled: !!address,
    });
}
