import { useEffect } from "react";

import { useDispatch } from "react-redux";

import { INVITE_CODE_API } from "../app/api";
import { setInviteCode } from "../state/registerSlice";

const ID = "bounce-invite-code";

const InviteCodeHandler = () => {
  const dispatch = useDispatch();
  useEffect(() => {
    const inviteCode = localStorage.getItem(ID);
    if (!inviteCode) return;

    fetch(`${INVITE_CODE_API}?inviteCode=${inviteCode}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) return;
        if (data) return;

        localStorage.setItem(ID, inviteCode);
        dispatch(setInviteCode(inviteCode));
      });
  }, [dispatch]);
  return null;
};

export default InviteCodeHandler;
