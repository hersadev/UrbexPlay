import { useEffect, useId, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  children: ReactNode;
  /** Cerrar con Escape. Sin ella el diálogo es obligatorio: solo se va con sus botones. */
  onClose?: () => void;
}

/** Diálogo sobre toda la app, mapa incluido. */
export default function Modal({ title, children, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={heading}
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
      // Algunos navegadores cierran con un segundo Escape aunque se cancele el primero.
      onClose={() => {
        if (onClose) onClose();
        else if (ref.current?.isConnected) ref.current.showModal();
      }}
    >
      <h2 id={heading}>{title}</h2>
      {children}
    </dialog>
  );
}
