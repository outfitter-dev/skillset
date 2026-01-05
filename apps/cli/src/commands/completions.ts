/**
 * skillset completions command
 */

import chalk from "chalk";
import type { Command } from "commander";
import { CLIError } from "../errors";

type ShellType = "bash" | "zsh" | "fish" | "powershell";

/**
 * Generate bash completions
 */
function generateBashCompletions(): string {
  return `# skillset bash completion
_skillset_completions() {
  local cur=\${COMP_WORDS[COMP_CWORD]}
  local cmd=\${COMP_WORDS[1]}

  if [[ $COMP_CWORD == 1 ]]; then
    COMPREPLY=($(compgen -W "load set skills sync alias unalias config doctor index init completions" -- $cur))
  elif [[ $cmd == "set" ]]; then
    COMPREPLY=($(compgen -W "list show load" -- $cur))
  elif [[ $cmd == "completions" ]]; then
    COMPREPLY=($(compgen -W "bash zsh fish powershell" -- $cur))
  elif [[ $cmd == "config" ]]; then
    COMPREPLY=($(compgen -W "show generated get set reset gc" -- $cur))
  elif [[ $cmd == "skills" ]]; then
    COMPREPLY=($(compgen -W "list add remove" -- $cur))
  fi
}
complete -F _skillset_completions skillset
`;
}

/**
 * Generate zsh completions
 */
function generateZshCompletions(): string {
  return `#compdef skillset

_skillset() {
  local -a commands
  commands=(
    'load:Load and output skill content'
    'set:Manage skill sets (groups of skills)'
    'skills:Manage skill mappings'
    'sync:Sync skills to configured targets'
    'alias:Add or update a skill alias (deprecated)'
    'unalias:Remove a skill alias (deprecated)'
    'config:Manage skillset configuration'
    'doctor:Check skillset installation and configuration'
    'index:Scan for SKILL.md files and refresh cache'
    'init:Scaffold config files with sensible defaults'
    'completions:Generate shell completions'
  )

  if (( CURRENT == 2 )); then
    _describe 'command' commands
  else
    case "\${words[2]}" in
      set)
        _values 'subcommand' list show load
        ;;
      completions)
        _values 'shell' bash zsh fish powershell
        ;;
      config)
        _values 'subcommand' show generated get set reset gc
        ;;
      skills)
        _values 'subcommand' list add remove
        ;;
    esac
  fi
}

_skillset
`;
}

/**
 * Generate fish completions
 */
function generateFishCompletions(): string {
  return `# skillset fish completion

# Main commands
complete -c skillset -f -n "__fish_use_subcommand" -a "load" -d "Load and output skill content"
complete -c skillset -f -n "__fish_use_subcommand" -a "set" -d "Manage skill sets (groups of skills)"
complete -c skillset -f -n "__fish_use_subcommand" -a "skills" -d "Manage skill mappings"
complete -c skillset -f -n "__fish_use_subcommand" -a "sync" -d "Sync skills to configured targets"
complete -c skillset -f -n "__fish_use_subcommand" -a "alias" -d "Add or update a skill alias"
complete -c skillset -f -n "__fish_use_subcommand" -a "unalias" -d "Remove a skill alias"
complete -c skillset -f -n "__fish_use_subcommand" -a "config" -d "Manage skillset configuration"
complete -c skillset -f -n "__fish_use_subcommand" -a "doctor" -d "Check skillset installation and configuration"
complete -c skillset -f -n "__fish_use_subcommand" -a "index" -d "Scan for SKILL.md files and refresh cache"
complete -c skillset -f -n "__fish_use_subcommand" -a "init" -d "Scaffold config files with sensible defaults"
complete -c skillset -f -n "__fish_use_subcommand" -a "completions" -d "Generate shell completions"

# Global flags
complete -c skillset -l json -d "JSON output"
complete -c skillset -l raw -d "Raw output for piping"
complete -c skillset -s q -l quiet -d "Suppress non-essential output"
complete -c skillset -s v -l verbose -d "Extra detail"
complete -c skillset -s s -l source -d "Filter by source namespace"
complete -c skillset -l kind -d "Disambiguate skill vs set"

# Completions subcommand
complete -c skillset -f -n "__fish_seen_subcommand_from completions" -a "bash zsh fish powershell"

# Config subcommand
complete -c skillset -f -n "__fish_seen_subcommand_from config" -a "show generated get set reset gc"

# Skills subcommand
complete -c skillset -f -n "__fish_seen_subcommand_from skills" -a "list add remove"

# Set subcommand
complete -c skillset -f -n "__fish_seen_subcommand_from set" -a "list show load"
`;
}

/**
 * Generate PowerShell completions
 */
function generatePowerShellCompletions(): string {
  return `# skillset PowerShell completion

Register-ArgumentCompleter -Native -CommandName skillset -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

    $commands = @(
        'load',
        'set',
        'skills',
        'sync',
        'alias',
        'unalias',
        'config',
        'doctor',
        'index',
        'init',
        'completions'
    )

    $commandAst.CommandElements | Select-Object -Skip 1 -First 1 | ForEach-Object {
        $subcommand = $_.Value

        switch ($subcommand) {
            'completions' {
                @('bash', 'zsh', 'fish', 'powershell') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
            'config' {
                @('show', 'generated', 'get', 'set', 'reset', 'gc') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
            'skills' {
                @('list', 'add', 'remove') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
            'set' {
                @('list', 'show', 'load') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
            default {
                $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
        }
    }
}
`;
}

/**
 * Generate shell completions
 */
function generateCompletions(shell: ShellType): void {
  let output: string;

  switch (shell) {
    case "bash":
      output = generateBashCompletions();
      break;
    case "zsh":
      output = generateZshCompletions();
      break;
    case "fish":
      output = generateFishCompletions();
      break;
    case "powershell":
      output = generatePowerShellCompletions();
      break;
    default:
      console.error(chalk.red(`Unknown shell: ${shell}`));
      console.error(
        chalk.yellow("Supported shells: bash, zsh, fish, powershell")
      );
      throw new CLIError(`Unknown shell: ${shell}`, { alreadyLogged: true });
  }

  console.log(output);
}

/**
 * Register the completions command
 */
export function registerCompletionsCommand(program: Command): void {
  program
    .command("completions <shell>")
    .description("Generate shell completions")
    .action((shell: string) => {
      const validShells: ShellType[] = ["bash", "zsh", "fish", "powershell"];
      if (!validShells.includes(shell as ShellType)) {
        console.error(chalk.red(`Unknown shell: ${shell}`));
        console.error(
          chalk.yellow("Supported shells: bash, zsh, fish, powershell")
        );
        throw new CLIError(`Unknown shell: ${shell}`, { alreadyLogged: true });
      }
      generateCompletions(shell as ShellType);
    });
}
