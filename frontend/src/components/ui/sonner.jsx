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
          // Two overrides. Sonner reveals its close button on hover, which never happens on
          // a phone — and this board is used on one — so it is forced visible. And it takes
          // the toast's own colour rather than a panel of its own, which a solid background
          // would make of it against the tinted success and error toasts richColors draws.
          closeButton:
            "group-[.toast]:!opacity-100 group-[.toast]:!bg-transparent group-[.toast]:!text-current group-[.toast]:!border-transparent group-[.toast]:hover:!bg-black/10",
        },
      }}
      {...props} />
  );
}

export { Toaster, toast }
