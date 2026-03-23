import { useEffect } from "react";

import { useDispatch } from "react-redux";

import { setHasRegistered } from "../state/registerSlice";

export const HAS_REGISTERED_ID = "bounce-has-registered";

const HasRegisteredHandler = () => {
  const dispatch = useDispatch();

  useEffect(() => {
    const hasRegistered_ = localStorage.getItem(HAS_REGISTERED_ID);
    if (!hasRegistered_ || hasRegistered_ !== "true") return;
    dispatch(setHasRegistered(true));
  }, [dispatch]);

  return null;
};

export default HasRegisteredHandler;
