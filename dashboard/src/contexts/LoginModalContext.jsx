import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

const LoginModalContext = createContext({
  isOpen: false,
  request: null,
  openLoginModal: () => {},
  closeLoginModal: () => {},
  completeLoginModal: () => {},
});

export function LoginModalProvider({ children }) {
  const location = useLocation();
  const locationKey = useRef(location.key);
  locationKey.current = location.key;
  const [isOpen, setIsOpen] = useState(false);
  const [request, setRequest] = useState(null);
  const pending = useRef(null);
  const requestSequence = useRef(0);
  const openLoginModal = useCallback((options) => {
    // Existing callers pass this callback directly to onClick. A MouseEvent
    // has none of these explicit options and opens the ordinary login dialog.
    const next = {
      id: ++requestSequence.current,
      locationKey: locationKey.current,
      subtitle: typeof options?.subtitle === "string" ? options.subtitle : undefined,
    };
    pending.current = next;
    setRequest(next);
    setIsOpen(true);
  }, []);
  const closeLoginModal = useCallback((requestId) => {
    const current = pending.current;
    if (!current || (typeof requestId === "number" && current.id !== requestId)) return;
    // Invalidate before the closing animation or a late auth result can run.
    pending.current = null;
    setIsOpen(false);
  }, []);
  const completeLoginModal = useCallback((requestId) => {
    const current = pending.current;
    if (!current || current.id !== requestId) return;
    if (current.locationKey !== locationKey.current) {
      closeLoginModal(requestId);
      return;
    }
    pending.current = null;
    setIsOpen(false);
  }, [closeLoginModal]);
  useEffect(() => {
    const current = pending.current;
    if (current && current.locationKey !== location.key) closeLoginModal(current.id);
  }, [location.key, closeLoginModal]);

  return (
    <LoginModalContext.Provider value={{ isOpen, request, openLoginModal, closeLoginModal, completeLoginModal }}>
      {children}
    </LoginModalContext.Provider>
  );
}

export function useLoginModal() {
  return useContext(LoginModalContext);
}
