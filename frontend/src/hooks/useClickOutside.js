import { useEffect } from 'react';

const useClickOutside = ({ enabled, ref, onOutsideClick, eventType = 'mousedown' }) => {
    useEffect(() => {
        if (!enabled || !ref?.current) return undefined;

        const handleOutsideClick = (event) => {
            if (ref.current && !ref.current.contains(event.target)) {
                onOutsideClick?.(event);
            }
        };

        document.addEventListener(eventType, handleOutsideClick);
        return () => {
            document.removeEventListener(eventType, handleOutsideClick);
        };
    }, [enabled, eventType, onOutsideClick, ref]);
};

export default useClickOutside;
