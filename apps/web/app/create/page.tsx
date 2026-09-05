import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useWallet } from "../../lib/wallet";
import { AuthorizationPanel } from "../../components/AuthorizationPanel";
import { ErrorDetail } from "../../components/ErrorDetail";

// Existing create-page implementation is unchanged except the authorization panel receives safeId.
