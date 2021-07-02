import React from "react";

import { Text, useInput } from "ink";

const PauseScript: React.FC<{ onConfirm: () => void }> = ({ onConfirm }) => {
    useInput((_input, keys) => keys.return && onConfirm())

    return <Text color="green">Press <Text bold>enter</Text> to continue or CTRL+C to exit...</Text>
}

export default PauseScript