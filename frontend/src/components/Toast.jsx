import { createContext, useCallback, useContext, useState, useEffect } from 'react';
import { X, CheckCircle, AlertTriangle, Info, XCircle } from 'lucide-react';

const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) return { addToast: () => {}, removeToast: () => {} };
  return ctx;
}

const iconMap = { success: CheckCircle, error: XCircle, warning: AlertTriangle, info: Info };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type, entering: true }]);
    requestAnimationFrame(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, entering: false } : t));
    });
    if (duration > 0) {
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
    }
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <div className="toast-container" role="status" aria-live="polite">
        {toasts.map(toast => {
          const Icon = iconMap[toast.type] || iconMap.info;
          return (
            <div key={toast.id} className={`toast toast-${toast.type}${toast.entering ? ' entering' : ''}`}>
              <div className="toast-icon"><Icon size={18} /></div>
              <span className="toast-msg">{toast.message}</span>
              <button className="toast-close" onClick={() => removeToast(toast.id)} aria-label="Dismiss">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
