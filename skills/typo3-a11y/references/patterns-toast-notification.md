# Pattern: Toast / Notification

Lightweight notification system for form feedback and user messages, without jQuery.

## TypeScript

```typescript
// TypeScript/Plugins/toast.ts

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastOptions {
    message: string;
    type?: ToastType;
    duration?: number; // ms, 0 = manual dismiss
    ariaLive?: 'polite' | 'assertive';
}

const CONTAINER_ID = 'toast-container';
const DEFAULT_DURATION = 5000;

function getOrCreateContainer(): HTMLElement {
    let container = document.getElementById(CONTAINER_ID);
    if (!container) {
        container = document.createElement('div');
        container.id = CONTAINER_ID;
        container.className = 'toast-container';
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-atomic', 'false');
        document.body.appendChild(container);
    }
    return container;
}

function createIcon(type: ToastType): SVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('aria-hidden', 'true');

    const paths: Record<ToastType, string[]> = {
        success: ['M20 6L9 17l-5-5'],
        error: ['M12 12m-10 0a10 10 0 1020 0a10 10 0 10-20 0', 'M15 9l-6 6', 'M9 9l6 6'],
        warning: ['M12 9v4', 'M12 17h.01'],
        info: ['M12 12m-10 0a10 10 0 1020 0a10 10 0 10-20 0', 'M12 16v-4', 'M12 8h.01'],
    };

    paths[type].forEach((d) => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
    });

    return svg;
}

export function showToast(options: ToastOptions): void {
    const {
        message,
        type = 'info',
        duration = DEFAULT_DURATION,
        ariaLive,
    } = options;

    const container = getOrCreateContainer();
    container.setAttribute('aria-live', ariaLive ?? (type === 'error' ? 'assertive' : 'polite'));

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.setAttribute('role', 'status');

    // Icon
    const iconWrap = document.createElement('span');
    iconWrap.className = 'toast__icon';
    iconWrap.appendChild(createIcon(type));
    toast.appendChild(iconWrap);

    // Message
    const text = document.createElement('span');
    text.className = 'toast__message';
    text.textContent = message;
    toast.appendChild(text);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast__close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', () => removeToast(toast));
    toast.appendChild(closeBtn);

    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('toast--visible');
    });

    if (duration > 0) {
        setTimeout(() => removeToast(toast), duration);
    }
}

function removeToast(toast: HTMLElement): void {
    toast.classList.remove('toast--visible');
    toast.classList.add('toast--exit');

    toast.addEventListener('transitionend', () => {
        toast.remove();
    }, { once: true });

    // Fallback if transition doesn't fire
    setTimeout(() => {
        if (toast.parentNode) {
            toast.remove();
        }
    }, 400);
}

// Convenience methods
export const toast = {
    success: (message: string, duration?: number) =>
        showToast({ message, type: 'success', duration }),
    error: (message: string, duration?: number) =>
        showToast({ message, type: 'error', duration: duration ?? 0 }),
    warning: (message: string, duration?: number) =>
        showToast({ message, type: 'warning', duration }),
    info: (message: string, duration?: number) =>
        showToast({ message, type: 'info', duration }),
};
```

## SCSS

```scss
// Components/_toast.scss

.toast-container {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    z-index: 1090;
    display: flex;
    flex-direction: column-reverse;
    gap: 0.5rem;
    max-width: 24rem;
    pointer-events: none;

    @media (max-width: map-get($grid-breakpoints, sm) - 0.02px) {
        left: 1rem;
        right: 1rem;
        max-width: none;
    }
}

.toast {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    border-radius: $border-radius;
    background-color: $white;
    box-shadow: 0 0.25rem 1rem rgba(0, 0, 0, 0.15);
    border-left: 0.25rem solid $gray-400;
    pointer-events: auto;

    opacity: 0;
    transform: translateY(1rem);
    transition: opacity 0.3s ease, transform 0.3s ease;

    &--visible {
        opacity: 1;
        transform: translateY(0);
    }

    &--exit {
        opacity: 0;
        transform: translateX(100%);
    }

    &--success { border-left-color: $success; .toast__icon { color: $success; } }
    &--error   { border-left-color: $danger;  .toast__icon { color: $danger; } }
    &--warning { border-left-color: $warning; .toast__icon { color: $warning; } }
    &--info    { border-left-color: $info;    .toast__icon { color: $info; } }

    &__icon {
        flex-shrink: 0;
        display: flex;
        margin-top: 0.125rem;
    }

    &__message {
        flex-grow: 1;
        font-size: 0.875rem;
        line-height: 1.4;
    }

    &__close {
        flex-shrink: 0;
        background: none;
        border: none;
        font-size: 1.25rem;
        line-height: 1;
        color: $text-muted;
        cursor: pointer;
        padding: 0;

        &:hover { color: $body-color; }
    }
}

@media (prefers-reduced-motion: reduce) {
    .toast { transition: none; }
}
```

## Usage

```typescript
import { toast } from '../TypeScript/Plugins/toast';

toast.success('Formular erfolgreich gesendet.');
toast.error('Ein Fehler ist aufgetreten.');
toast.warning('Sitzung läuft bald ab.');
toast.info('Neue Inhalte verfügbar.', 8000);
```

## Accessibility

- `aria-live="polite"` for success/info/warning
- `aria-live="assertive"` for errors
- `role="status"` on each toast
- Error toasts stay until manually dismissed (`duration: 0`)
