import { useNavigate } from "react-router";

import { HOME_ROUTE } from "../../app/routes";
import Button from "../shared/Button";
import Fallback from "../shared/Fallback";

interface Props {
  title?: string;
  message?: string;
}

export default function NotFound({
  title = "Page not found",
  message = "We couldn't find what you were looking for. The page may have moved, or the link could be broken.",
}: Props) {
  const navigate = useNavigate();
  return (
    <Fallback
      code="404"
      title={title}
      message={message}
      actions={
        <Button
          variant="primary"
          size="md"
          onClick={() => {
            navigate(HOME_ROUTE);
          }}
        >
          Return to home
        </Button>
      }
    />
  );
}
