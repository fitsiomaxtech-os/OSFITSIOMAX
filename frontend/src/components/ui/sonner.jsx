import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"

const Toaster = ({
  ...props
}) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      // Every toast gets a dismiss button. Left to time out on its own, a message that
      // lands over the thing it is describing has to be waited out; this lets it be put
      // away. Set here rather than per call so no toast in the app is missing one.
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          // Red, at the faintest wash that still reads as red — dismissing is the one
          // destructive thing a toast offers, and it should look like it without shouting
          // over the message. Forced visible too: sonner only reveals this on hover, which
          // never happens on a phone, and these boards are used on one.
          closeButton:
            "group-[.toast]:!opacity-100 group-[.toast]:!bg-red-500/10 group-[.toast]:!border-red-400 group-[.toast]:!text-red-600 group-[.toast]:hover:!bg-red-500/20",
        },
      }}
      {...props} />
  );
}

export { Toaster, toast }
